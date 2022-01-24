//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract DisintermediatedGrants is Ownable {
    address public multisig;
    uint256 public donationGracePeriod;

    uint256 public donationCount = 0;
    uint256 public grantCount = 0;

    struct Donation {
        address donor;
        address token;
        uint256 amount;
        uint256 disbursedAmount;
        bool withdrawn;
    }

    struct Grant {
        uint256 donationId;
        address recipient;
        uint256 amount;
        bool endorsed;
        bool disbursed;
        uint256 endorsedAt;
    }

    mapping(address => bool) public donorWhitelisted;
    mapping(uint256 => Donation) public donations;
    mapping(uint256 => Grant) public grants;

    event WhitelistDonor(address donor);
    event Donate(Donation donation);
    event WithdrawDonation(Donation donation);
    event ProposeGrant(Grant grant);
    event EndorseGrant(Grant grant);
    event DisburseGrant(Grant grant);

    modifier onlyWhitelistedDonor {
        require(donorWhitelisted[msg.sender], "caller is not whitelisted donor");
        _;
    }

    modifier onlyMultisig {
        require(msg.sender == multisig, "caller is not the multisig");
        _;
    }

    constructor(address _multisig, uint256 _donationGracePeriod) {
        multisig = _multisig;
        donationGracePeriod = _donationGracePeriod;
    }

    function whitelistDonor(address _donor) public onlyOwner {
        donorWhitelisted[_donor] = true;
        emit WhitelistDonor(_donor);
    }

    function donate(address _token, uint256 _amount) public onlyWhitelistedDonor {
        Donation memory donation = Donation({
            donor: msg.sender,
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

    function withdrawDonation(uint256 _donationId) public {
        Donation storage donation = donations[_donationId];
        require(msg.sender == donation.donor, "caller is not donor");
        require(donation.amount > donation.disbursedAmount, "donation has already been disbursed");

        donation.withdrawn = true;

        emit WithdrawDonation(donation);
        IERC20Metadata(donation.token).transferFrom(address(this), donation.donor, donation.amount - donation.disbursedAmount);
    }

    function proposeGrant(
        uint256 _donationId,
        address _recipient,
        uint256 _amount
    ) public onlyOwner {
        Grant memory grant = Grant({
            donationId: _donationId,
            recipient: _recipient,
            amount: _amount,
            endorsed: false,
            disbursed: false,
            endorsedAt: 0
        });

        grants[grantCount] = grant;

        grantCount += 1;
        emit ProposeGrant(grant);
    }

    function endorseGrant(uint256 grantId) public onlyMultisig {
        Grant storage grant = grants[grantId];
        grant.endorsed = true;
        grant.endorsedAt = block.number;
        emit EndorseGrant(grant);
    }

    function disburseGrant(uint256 grantId) public {
        Grant storage grant = grants[grantId];
        Donation storage donation = donations[grant.donationId];
        require(donation.withdrawn, "donation has been withdrawn");
        require(grant.endorsed, "grant has not been endorsed");
        require(block.number >= grant.endorsedAt + donationGracePeriod, "donation grace period has not ended");
        require(grant.amount <= donation.amount - donation.disbursedAmount, "grant amount exceeds donation balance");

        donation.disbursedAmount += grant.amount;
        grant.disbursed = true;

        emit DisburseGrant(grant);
        IERC20Metadata(donation.token).transferFrom(address(this), grant.recipient, grant.amount);
    }
}
