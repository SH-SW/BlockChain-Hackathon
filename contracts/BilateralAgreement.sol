// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BilateralAgreement
/// @notice Commit-reveal bilateral agreement with ECDSA verification.
///   Phases: Deploy → Deposit → Commit (last hour) → Reveal → Execute
contract BilateralAgreement {

    enum Status { Created, Deposited, Commit, Reveal, Executed, Failed }

    address public partyA;
    address public partyB;
    address public publicKeyA; // Independent ECDSA address for A
    address public publicKeyB; // Independent ECDSA address for B

    uint256 public amountA;
    uint256 public amountB;
    uint256 public depositedA;
    uint256 public depositedB;

    uint256 public commitDeadline;
    uint256 public commitWindowStart;
    uint256 public revealDeadline;

    bytes32 public hashA;
    bytes32 public hashB;
    bool public decisionA;
    bool public decisionB;
    bool public revealedA;
    bool public revealedB;

    Status public status;
    bool private _locked;

    event FundsDeposited(address indexed party, uint256 amount);
    event HashCommitted(address indexed party, bytes32 hash);
    event DecisionRevealed(address indexed party, bool decision);
    event ContractExecuted(bool bothAccepted);
    event FundsReturned(address indexed party, uint256 amount);
    event DeliveryConfirmed(address indexed mediator);

    modifier onlyParties() {
        require(msg.sender == partyA || msg.sender == partyB, "Not a party");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(
        address _partyB,
        uint256 _amountA,
        uint256 _amountB,
        address _mediator
    ) {
        partyA = msg.sender;
        partyB = _partyB;
        amountA = _amountA;
        amountB = _amountB;
        mediator = _mediator;
        status = Status.Created;
    }

    /// @notice Phase 1: Each party deposits their required amount.
    function depositFunds() external payable onlyParties {
        require(status == Status.Created, "Not in deposit phase");

        if (msg.sender == partyA) {
            require(depositedA == 0, "Already deposited");
            require(msg.value == amountA, "Wrong amount");
            depositedA = msg.value;
        } else {
            require(depositedB == 0, "Already deposited");
            require(msg.value == amountB, "Wrong amount");
            depositedB = msg.value;
        }

        emit FundsDeposited(msg.sender, msg.value);

        if (depositedA > 0 && depositedB > 0) {
            status = Status.Deposited;
        }
    }

    /// @notice Phase 2: Submit hash(decision || signature || salt) in the last hour before deadline.
    function commitHash(bytes32 _hash) external onlyParties {
        require(status == Status.Deposited || status == Status.Commit, "Not in commit phase");
        require(block.timestamp >= commitWindowStart, "Window not open");
        require(block.timestamp <= commitDeadline, "Commit ended");
        require(_hash != bytes32(0), "Empty hash");

        if (msg.sender == partyA) {
            require(hashA == bytes32(0), "Already committed");
            hashA = _hash;
        } else {
            require(hashB == bytes32(0), "Already committed");
            hashB = _hash;
        }

        if (status == Status.Deposited) status = Status.Commit;

        emit HashCommitted(msg.sender, _hash);
    }

    /// @notice Phase 3: Reveal decision + signature + salt. Verifies hash match and ECDSA signature.
    function revealDecision(
        uint8 _decision, uint8 _v, bytes32 _r, bytes32 _s, bytes32 _salt
    ) external onlyParties {
        require(block.timestamp > commitDeadline, "Commit not ended");
        require(block.timestamp <= revealDeadline, "Reveal ended");
        require(_decision <= 1, "0 or 1 only");

        if (status == Status.Deposited || status == Status.Commit) status = Status.Reveal;
        require(status == Status.Reveal, "Not in reveal phase");

        // Determine which party is revealing
        bool isA = (msg.sender == partyA);
        require(isA ? !revealedA : !revealedB, "Already revealed");
        require(isA ? hashA != bytes32(0) : hashB != bytes32(0), "Did not commit");

        // Verify hash: keccak256(decision || r,s,v || salt) == stored hash
        bytes memory sig = abi.encodePacked(_r, _s, _v);
        bytes32 computed = keccak256(abi.encodePacked(_decision, sig, _salt));
        require(computed == (isA ? hashA : hashB), "Hash mismatch");

        // Verify ECDSA signature against registered public key
        bytes32 msgHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(_decision)))
        );
        require(ecrecover(msgHash, _v, _r, _s) == (isA ? publicKeyA : publicKeyB), "Bad signature");

        // Record decision
        if (isA) { decisionA = (_decision == 1); revealedA = true; }
        else     { decisionB = (_decision == 1); revealedB = true; }

        emit DecisionRevealed(msg.sender, _decision == 1);
    }

    /// @notice Phase 4: Anyone calls after reveal deadline. Swaps funds or refunds.
    function executeContract() external nonReentrant {
        require(block.timestamp > revealDeadline, "Reveal not ended");
        require(
            status == Status.Reveal || status == Status.Commit ||
            status == Status.Deposited || status == Status.Created,
            "Already finalized"
        );

        bool bothAccepted = revealedA && revealedB && decisionA && decisionB;
        status = bothAccepted ? Status.Executed : Status.Failed;

        uint256 _dA = depositedA;
        uint256 _dB = depositedB;
        depositedA = 0;
        depositedB = 0;

        if (bothAccepted) {
            _transfer(partyA, _dB); // A gets B's deposit
            _transfer(partyB, _dA); // B gets A's deposit
        } else {
            _transfer(partyA, _dA); // Refund A
            _transfer(partyB, _dB); // Refund B
        }

        emit ContractExecuted(bothAccepted);
    }

    function _transfer(address _to, uint256 _amount) internal {
        if (_amount == 0) return;
        (bool ok, ) = payable(_to).call{value: _amount}("");
        require(ok, "Transfer failed");
        emit FundsReturned(_to, _amount);
    }

    // Remove commit-reveal scheme and replace with escrow logic
    address public mediator; // Trusted third-party mediator
    bool public deliveryConfirmed;

    modifier onlyMediator() {
        require(msg.sender == mediator, "Not the mediator");
        _;
    }

    function confirmDelivery() external onlyMediator {
        require(status == Status.Deposited, "Invalid status");
        deliveryConfirmed = true;
        status = Status.Executed;
        payable(partyB).transfer(amountA + amountB);
    }

    function dispute() external onlyParties {
        require(status == Status.Deposited, "Invalid status");
        status = Status.Failed;
        payable(partyA).transfer(amountA);
        payable(partyB).transfer(amountB);
    }
}
