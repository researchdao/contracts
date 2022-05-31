// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract DisintermediatedGrants {
    address public immutable multisig;
    uint256 public immutable donationGracePeriod;

    uint256 public donationCount = 0;
    uint256 public grantCount = 0;

    struct Donation {
        address donor;
        bool nativeToken;
        address token;
        uint256 amount;
        uint256 disbursedAmount;
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

    constructor(address _multisig, uint256 _donationGracePeriod) {
        multisig = _multisig;
        donationGracePeriod = _donationGracePeriod;
    }

    function whitelistDonor(address _donor) public onlyMultisig {
        donorWhitelisted[_donor] = true;
        emit WhitelistDonor(_donor);
    }

    function donate(address _token, uint256 _amount) public onlyWhitelistedDonor {
        require(_amount > 0, "donation amount cannot be zero");
        Donation memory donation = Donation({
            donor: msg.sender,
            nativeToken: false,
            token: _token,
            amount: _amount,
            disbursedAmount: 0,
            withdrawn: false
        });

        donations[donationCount] = donation;
        donationCount += 1;

        emit Donate(donation);
        IERC20Metadata(_token).transferFrom(msg.sender, address(this), _amount);
    }

    receive() external payable {
        revert();
    }

    function donateNative() public payable onlyWhitelistedDonor {
        require(msg.value > 0, "donation amount cannot be zero");
        Donation memory donation = Donation({
            donor: msg.sender,
            nativeToken: true,
            token: address(0),
            amount: msg.value,
            disbursedAmount: 0,
            withdrawn: false
        });

        donations[donationCount] = donation;
        donationCount += 1;

        emit Donate(donation);
    }

    function withdrawDonation(uint256 _donationId) public {
        Donation storage donation = donations[_donationId];
        require(msg.sender == donation.donor, "caller is not donor");
        require(!donation.withdrawn, "donation has already been withdrawn");
        require(donation.amount > donation.disbursedAmount, "donation has been fully disbursed");

        donation.withdrawn = true;

        emit WithdrawDonation(donation);
        if (donation.nativeToken) {
            payable(donation.donor).transfer(donation.amount - donation.disbursedAmount);
        } else {
            IERC20Metadata(donation.token).transfer(donation.donor, donation.amount - donation.disbursedAmount);
        }
    }

    function proposeGrant(GrantProposal memory _grantProposal) public onlyMultisig {
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
        require(block.number >= grant.proposedAt + donationGracePeriod, "donation grace period has not ended");
        require(grant.amount <= donation.amount - donation.disbursedAmount, "grant amount exceeds donation balance");

        donation.disbursedAmount += grant.amount;
        grant.disbursed = true;

        emit DisburseGrant(grant);
        if (donation.nativeToken) {
            payable(grant.recipient).transfer(grant.amount);
        } else {
            IERC20Metadata(donation.token).transfer(grant.recipient, grant.amount);
        }
    }
}
