// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BilateralAgreement
/// @notice Commit-reveal bilateral agreement with ECDSA verification.
///   Deposit = 10% of each party's transaction amount, used as a penalty guarantee.
///   Phases: Deploy → Deposit → Commit (last hour) → Reveal → Execute
contract BilateralAgreement {

    enum Status { Created, Deposited, Commit, Reveal, Executed, Failed }

    address public partyA;
    address public partyB;
    address public publicKeyA; // Independent ECDSA address for A
    address public publicKeyB; // Independent ECDSA address for B

    uint256 public amountA;    // Total transaction amount for A
    uint256 public amountB;    // Total transaction amount for B
    uint256 public depositA;   // 10% of amountA (security deposit)
    uint256 public depositB;   // 10% of amountB (security deposit)
    uint256 public depositedA; // Actual ETH deposited by A
    uint256 public depositedB; // Actual ETH deposited by B

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
        address _publicKeyA,
        address _publicKeyB,
        uint256 _amountA,
        uint256 _amountB,
        uint256 _commitPeriodDays,
        uint256 _revealPeriodHours
    ) {
        require(_partyB != address(0) && _partyB != msg.sender, "Invalid partyB");
        require(_publicKeyA != address(0) && _publicKeyB != address(0), "Invalid keys");
        require(_amountA > 0 && _amountB > 0, "Amounts must be > 0");
        require(_commitPeriodDays >= 1 && _commitPeriodDays <= 7, "1-7 days");
        require(_revealPeriodHours >= 1 && _revealPeriodHours <= 48, "1-48 hours");

        partyA = msg.sender;
        partyB = _partyB;
        publicKeyA = _publicKeyA;
        publicKeyB = _publicKeyB;
        amountA = _amountA;
        amountB = _amountB;
        depositA = _amountA / 10; // 10% security deposit
        depositB = _amountB / 10; // 10% security deposit
        require(depositA > 0 && depositB > 0, "Amounts too small for 10% deposit");

        commitDeadline = block.timestamp + (_commitPeriodDays * 1 days);
        commitWindowStart = commitDeadline - 1 hours;
        revealDeadline = commitDeadline + (_revealPeriodHours * 1 hours);
    }

    /// @notice Phase 1: Each party deposits 10% of their transaction amount as security.
    function depositFunds() external payable onlyParties {
        require(status == Status.Created, "Not in deposit phase");

        if (msg.sender == partyA) {
            require(depositedA == 0, "Already deposited");
            require(msg.value == depositA, "Wrong amount");
            depositedA = msg.value;
        } else {
            require(depositedB == 0, "Already deposited");
            require(msg.value == depositB, "Wrong amount");
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

    /// @notice Phase 4: Anyone calls after reveal deadline.
    ///   Both accept    → each recovers their deposit (agreement fulfilled)
    ///   One rejects    → rejector LOSES deposit to the other party (penalty)
    ///   Neither accepts→ each recovers their own (mutual disagreement)
    ///   Non-participation → each recovers their own
    function executeContract() external nonReentrant {
        require(block.timestamp > revealDeadline, "Reveal not ended");
        require(
            status == Status.Reveal || status == Status.Commit ||
            status == Status.Deposited || status == Status.Created,
            "Already finalized"
        );

        bool aAccepted = revealedA && decisionA;
        bool bAccepted = revealedB && decisionB;
        bool bothAccepted = aAccepted && bAccepted;

        status = bothAccepted ? Status.Executed : Status.Failed;

        uint256 _dA = depositedA;
        uint256 _dB = depositedB;
        depositedA = 0;
        depositedB = 0;

        if (bothAccepted) {
            // Both accepted → each recovers their own deposit
            _transfer(partyA, _dA);
            _transfer(partyB, _dB);
        } else if (aAccepted && !bAccepted) {
            // A honored the agreement, B did not → A gets both deposits
            _transfer(partyA, _dA + _dB);
        } else if (!aAccepted && bAccepted) {
            // B honored the agreement, A did not → B gets both deposits
            _transfer(partyB, _dA + _dB);
        } else {
            // Mutual disagreement or non-participation → each recovers their own
            _transfer(partyA, _dA);
            _transfer(partyB, _dB);
        }

        emit ContractExecuted(bothAccepted);
    }

    function _transfer(address _to, uint256 _amount) internal {
        if (_amount == 0) return;
        (bool ok, ) = payable(_to).call{value: _amount}("");
        require(ok, "Transfer failed");
        emit FundsReturned(_to, _amount);
    }
}
