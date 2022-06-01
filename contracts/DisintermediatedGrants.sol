// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DisintermediatedGrants {
    address public immutable multisig;

    uint256 public donationCount = 0;
    uint256 public grantCount = 0;

    uint32 public constant MAX_DONATION_GRACE_PERIOD = 600_000;

    struct Donation {
        address donor;
        address token;
        uint256 amount;
        uint256 disbursedAmount;
        uint32 gracePeriod;
        bool withdrawn;
    }

    struct Grant {
        uint256 donationId;
        address recipient;
        uint256 amount;
        bool disbursed;
        uint256 proposedAt;
    }

    struct GrantProposal {
        uint256 donationId;
        address recipient;
        uint256 amount;
    }

    mapping(address => bool) public donorWhitelisted;
    mapping(uint256 => Donation) public donations;
    mapping(uint256 => Grant) public grants;

    event WhitelistDonor(address donor);
    event Donate(Donation donation);
    event WithdrawDonation(Donation donation);
    event ProposeGrant(Grant grant);
    event DisburseGrant(Grant grant);

    modifier onlyWhitelistedDonor() {
        require(donorWhitelisted[msg.sender], "caller is not whitelisted donor");
        _;
    }

    modifier onlyMultisig() {
        require(msg.sender == multisig, "caller is not the multisig");
        _;
    }

    constructor(address _multisig) {
        multisig = _multisig;
    }

    function whitelistDonor(address _donor) public onlyMultisig {
        donorWhitelisted[_donor] = true;
        emit WhitelistDonor(_donor);
    }

    function donate(
        address _token,
        uint256 _amount,
        uint32 _gracePeriod
    ) public onlyWhitelistedDonor {
        require(_amount > 0, "donation amount cannot be zero");
        require(_gracePeriod <= MAX_DONATION_GRACE_PERIOD, "withdrawal grace period is too long");
        require(ERC20(_token).balanceOf(msg.sender) >= _amount, "donation amount exceeds balance");
        require(
            ERC20(_token).allowance(msg.sender, address(this)) >= _amount,
            "insufficient donation amount allowance"
        );

        Donation memory donation = Donation({
            donor: msg.sender,
            token: _token,
            amount: _amount,
            disbursedAmount: 0,
            gracePeriod: _gracePeriod,
            withdrawn: false
        });

        donations[donationCount] = donation;
        donationCount += 1;

        emit Donate(donation);
    }

    receive() external payable {
        revert("deposits not permitted");
    }

    function withdrawDonation(uint256 _donationId) public {
        Donation storage donation = donations[_donationId];
        require(msg.sender == donation.donor, "caller is not donor");
        require(!donation.withdrawn, "donation has already been withdrawn");
        require(donation.amount > donation.disbursedAmount, "donation has been fully disbursed");

        donation.withdrawn = true;

        emit WithdrawDonation(donation);
    }

    function proposeGrant(GrantProposal memory _grantProposal) public onlyMultisig {
        require(_grantProposal.donationId < donationCount, "donation does not exist");
        Donation memory donation = donations[_grantProposal.donationId];
        require(
            donation.amount - donation.disbursedAmount >= _grantProposal.amount,
            "donation cannot cover full grant amount"
        );

        Grant memory grant = Grant({
            donationId: _grantProposal.donationId,
            recipient: _grantProposal.recipient,
            amount: _grantProposal.amount,
            disbursed: false,
            proposedAt: block.number
        });

        grants[grantCount] = grant;
        grantCount += 1;

        emit ProposeGrant(grant);
    }

    function proposeGrants(GrantProposal[] memory _grantProposals) public {
        for (uint16 i = 0; i < _grantProposals.length; ++i) {
            proposeGrant(_grantProposals[i]);
        }
    }

    function disburseGrant(uint256 _grantId) public {
        require(_grantId < grantCount, "grant does not exist");
        Grant storage grant = grants[_grantId];
        require(!grant.disbursed, "grant has already been disbursed");
        Donation storage donation = donations[grant.donationId];
        require(!donation.withdrawn, "donation has been withdrawn");
        require(block.number >= grant.proposedAt + donation.gracePeriod, "donation grace period has not ended");
        require(grant.amount <= donation.amount - donation.disbursedAmount, "grant amount exceeds donation balance");
        require(
            ERC20(donation.token).allowance(donation.donor, address(this)) >= donation.amount,
            "donor has removed allowance"
        );

        donation.disbursedAmount += grant.amount;
        grant.disbursed = true;

        emit DisburseGrant(grant);
        ERC20(donation.token).transferFrom(donation.donor, grant.recipient, grant.amount);
    }
}
