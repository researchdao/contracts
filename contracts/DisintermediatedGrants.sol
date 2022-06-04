// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DisintermediatedGrants {
    address public immutable multisig;
    uint32 public immutable maxDonationGracePeriod;

    uint256 public donationCount = 0;
    uint256 public grantCount = 0;

    struct Donation {
        address donor;
        address token;
        uint32 gracePeriod;
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

    constructor(address _multisig, uint32 _maxDonationGracePeriod) {
        multisig = _multisig;
        maxDonationGracePeriod = _maxDonationGracePeriod;
    }

    function whitelistDonor(address _donor) public onlyMultisig {
        donorWhitelisted[_donor] = true;
        emit WhitelistDonor(_donor);
    }

    function donate(
        address _token,
        uint256 _commitmentAmount,
        uint32 _gracePeriod
    ) public onlyWhitelistedDonor {
        require(_commitmentAmount > 0, "commitment amount cannot be zero");
        require(_gracePeriod <= maxDonationGracePeriod, "withdrawal grace period is too long");
        require(
            ERC20(_token).balanceOf(msg.sender) >= _commitmentAmount,
            "insufficient balance to cover commitment amount"
        );
        require(
            ERC20(_token).allowance(msg.sender, address(this)) >= _commitmentAmount,
            "insufficient allowance to cover commitment amount"
        );

        Donation memory donation = Donation({donor: msg.sender, token: _token, gracePeriod: _gracePeriod});

        donations[donationCount] = donation;
        donationCount += 1;

        emit Donate(donation);
    }

    receive() external payable {
        revert("deposits not permitted");
    }

    function proposeGrant(GrantProposal memory _grantProposal) public onlyMultisig {
        require(_grantProposal.donationId < donationCount, "donation does not exist");
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
        for (uint16 i = 0; i < _grantProposals.length; i++) {
            proposeGrant(_grantProposals[i]);
        }
    }

    function disburseGrant(uint256 _grantId) public {
        require(_grantId < grantCount, "grant does not exist");
        Grant storage grant = grants[_grantId];
        require(!grant.disbursed, "grant has already been disbursed");
        require(grant.donationId < donationCount, "donation does not exist");
        Donation storage donation = donations[grant.donationId];
        require(block.number >= grant.proposedAt + donation.gracePeriod, "donation grace period has not ended");
        require(ERC20(donation.token).balanceOf(donation.donor) >= grant.amount, "insufficient donor balance");
        require(
            ERC20(donation.token).allowance(donation.donor, address(this)) >= grant.amount,
            "insufficient donor allowance"
        );

        grant.disbursed = true;

        emit DisburseGrant(grant);
        ERC20(donation.token).transferFrom(donation.donor, grant.recipient, grant.amount);
    }
}
