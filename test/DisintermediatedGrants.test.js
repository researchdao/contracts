const { expect } = require("chai")
const { ethers } = require("hardhat")
const { smock } = require("@defi-wonderland/smock")

const DONATION_GRACE_PERIOD = 10
const ERC20_TOKEN_AMOUNT = ethers.BigNumber.from(100)
const ETH_AMOUNT = ethers.BigNumber.from(100)

const whitelistDonor = (contract, donor) => {
    return contract.setVariable("donorWhitelisted", {
        [donor]: true,
    })
}

const setDonation = async (contract, donation) => {
    const donationId = await contract.donationCount()
    await contract.setVariable("donations", {
        [donationId]: donation,
    })
    return donationId
}

const setGrant = async (contract, grant) => {
    const grantId = await contract.grantCount()
    await contract.setVariable("grants", {
        [grantId]: grant,
    })
    return grantId
}

describe("DisintermediatedGrants", function () {
    before(async function () {
        const [owner, multisig, alice, bob, eve] = await ethers.getSigners()
        this.owner = owner
        this.multisig = multisig
        this.alice = alice
        this.bob = bob
        this.eve = eve
        this.parties = [alice, bob, eve]
        this.DisintermediatedGrants = await smock.mock("DisintermediatedGrants")
        this.TestERC20 = await ethers.getContractFactory("TestERC20")
    })
    beforeEach(async function () {
        this.grants = await this.DisintermediatedGrants.connect(this.owner).deploy(
            this.multisig.address,
            DONATION_GRACE_PERIOD
        )
        await this.grants.deployed()
        this.testERC20 = await this.TestERC20.deploy()
        await this.testERC20.deployed()
        this.parties.forEach(async (party) => {
            await this.testERC20.connect(party).mint(ERC20_TOKEN_AMOUNT)
            await this.testERC20.connect(party).approve(this.grants.address, ERC20_TOKEN_AMOUNT)
        })
        this.defaultERC20Donation = {
            donor: this.alice.address,
            nativeToken: false,
            token: this.testERC20.address,
            amount: ERC20_TOKEN_AMOUNT,
            disbursedAmount: 0,
            withdrawn: false,
        }
        this.defaultNativeDonation = {
            ...this.defaultERC20Donation,
            nativeToken: true,
            token: ethers.constants.AddressZero,
            amount: ETH_AMOUNT,
        }
        this.defaultERC20Grant = {
            donationId: 0,
            recipient: this.bob.address,
            amount: ERC20_TOKEN_AMOUNT,
            endorsed: false,
            disbursed: false,
            endorsedAt: await ethers.provider.getBlockNumber(),
        }
        this.defaultNativeGrant = {
            ...this.defaultERC20Grant,
            amount: ETH_AMOUNT,
        }
    })
    describe("donors", function () {
        it("cannot be whitelisted by non-owner", async function () {
            expect(await this.grants.donorWhitelisted(this.alice.address)).to.equal(false)
            await expect(this.grants.connect(this.eve).whitelistDonor(this.eve.address)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            )
        })
        it("can be whitelisted by owner", async function () {
            expect(await this.grants.donorWhitelisted(this.alice.address)).to.equal(false)
            const tx = await this.grants.connect(this.owner).whitelistDonor(this.alice.address)
            await expect(tx).to.emit(this.grants, "WhitelistDonor").withArgs(this.alice.address)
            expect(await this.grants.donorWhitelisted(this.alice.address)).to.equal(true)
        })
    })
    describe("ERC20 donations", function () {
        it("cannot be made by non-whitelisted donors", async function () {
            await expect(
                this.grants.connect(this.eve).donate(this.testERC20.address, ERC20_TOKEN_AMOUNT)
            ).to.be.revertedWith("caller is not whitelisted donor")
        })
        it("fail if donation amount exceeds donor balance", async function () {
            await whitelistDonor(this.grants, this.alice.address)
            const donorBalance = await this.testERC20.balanceOf(this.alice.address)
            await expect(
                this.grants.connect(this.alice).donate(this.testERC20.address, donorBalance.add(1))
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
        })
        it("fail if donation amount exceeds donor allowance", async function () {
            await whitelistDonor(this.grants, this.alice.address)
            const donorBalance = await this.testERC20.balanceOf(this.alice.address)
            await this.testERC20.connect(this.alice).mint(1)
            await expect(
                this.grants.connect(this.alice).donate(this.testERC20.address, donorBalance.add(1))
            ).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
        })
        it("can be made by whitelisted donors", async function () {
            await whitelistDonor(this.grants, this.alice.address)
            const donationCount = await this.grants.donationCount()
            const tx = await this.grants.connect(this.alice).donate(this.testERC20.address, ERC20_TOKEN_AMOUNT)
            const donation = await this.grants.donations(donationCount)
            expect(donation.donor).to.equal(this.alice.address)
            expect(donation.nativeToken).to.equal(false)
            expect(donation.token).to.equal(this.testERC20.address)
            expect(donation.amount).to.equal(ERC20_TOKEN_AMOUNT)
            expect(donation.disbursedAmount).to.equal(0)
            expect(donation.withdrawn).to.equal(false)
            await expect(tx).to.emit(this.grants, "Donate").withArgs(donation)
            expect(await this.testERC20.balanceOf(this.grants.address)).to.equal(ERC20_TOKEN_AMOUNT)
        })
    })
    describe("native donations", function () {
        it("cannot be made by non-whitelisted donors", async function () {
            await expect(this.grants.connect(this.eve).donateNative({ value: ETH_AMOUNT })).to.be.revertedWith(
                "caller is not whitelisted donor"
            )
        })
        it("can be made by whitelisted donors", async function () {
            await whitelistDonor(this.grants, this.alice.address)
            const donationCount = await this.grants.donationCount()
            const tx = await this.grants.connect(this.alice).donateNative({ value: ETH_AMOUNT })
            const donation = await this.grants.donations(donationCount)
            expect(donation.donor).to.equal(this.alice.address)
            expect(donation.nativeToken).to.equal(true)
            expect(donation.token).to.equal(ethers.constants.AddressZero)
            expect(donation.amount).to.equal(ETH_AMOUNT)
            expect(donation.disbursedAmount).to.equal(0)
            expect(donation.withdrawn).to.equal(false)
            await expect(tx).to.emit(this.grants, "Donate").withArgs(donation)
            expect(await ethers.provider.getBalance(this.grants.address)).to.equal(ETH_AMOUNT)
        })
    })
    describe("donation withdrawal", function () {
        before(async function () {
            await whitelistDonor(this.grants, this.alice.address)
        })
        it("fails for ERC20 donations if caller is not the donor", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultERC20Donation,
                donor: this.alice.address,
            })
            await expect(this.grants.connect(this.eve).withdrawDonation(donationId)).to.be.revertedWith(
                "caller is not donor"
            )
        })
        it("fails for native donations if caller is not the donor", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                donor: this.alice.address,
            })
            await expect(this.grants.connect(this.eve).withdrawDonation(donationId)).to.be.revertedWith(
                "caller is not donor"
            )
        })
        it("fails for ERC20 donations that have been fully disbursed", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultERC20Donation,
                disbursedAmount: ERC20_TOKEN_AMOUNT,
            })
            await expect(this.grants.connect(this.alice).withdrawDonation(donationId)).to.be.revertedWith(
                "donation has been fully disbursed"
            )
        })
        it("fails for native donations that have been fully disbursed", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                disbursedAmount: ETH_AMOUNT,
            })
            await expect(this.grants.connect(this.alice).withdrawDonation(donationId)).to.be.revertedWith(
                "donation has been fully disbursed"
            )
        })
        it("fails if ERC20 donation amount exceeds contract balance", async function () {
            const contractBalance = await this.testERC20.balanceOf(this.grants.address)
            const donationId = await setDonation(this.grants, {
                ...this.defaultERC20Donation,
                amount: contractBalance.add(1),
            })
            await expect(this.grants.connect(this.alice).withdrawDonation(donationId)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance"
            )
        })
        it("fails if native donation amount exceeds contract balance", async function () {
            const contractBalance = await ethers.provider.getBalance(this.grants.address)
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                amount: contractBalance.add(1),
            })
            await expect(this.grants.connect(this.alice).withdrawDonation(donationId)).to.be.revertedWith(
                "failed to withdraw donation"
            )
        })
        it("withdraws ERC20 funds to donor", async function () {
            const withdrawalAmount = ERC20_TOKEN_AMOUNT.div(2)
            await this.testERC20.connect(this.alice).transfer(this.grants.address, withdrawalAmount)
            const donorBalance = await this.testERC20.balanceOf(this.alice.address)
            const donationId = await setDonation(this.grants, {
                ...this.defaultERC20Donation,
                donor: this.alice.address,
                disbursedAmount: ERC20_TOKEN_AMOUNT.sub(withdrawalAmount),
            })
            const tx = await this.grants.connect(this.alice).withdrawDonation(donationId)
            const donation = await this.grants.donations(donationId)
            expect(donation.withdrawn).to.equal(true)
            await expect(tx).to.emit(this.grants, "WithdrawDonation").withArgs(donation)
            await expect(tx)
                .to.emit(this.testERC20, "Transfer")
                .withArgs(this.grants.address, this.alice.address, withdrawalAmount)
            expect(await this.testERC20.balanceOf(this.alice.address)).to.equal(donorBalance.add(withdrawalAmount))
        })
        it("withdraws native funds to donor", async function () {
            const withdrawalAmount = ETH_AMOUNT.div(2)
            await this.alice.sendTransaction({
                to: this.grants.address,
                value: withdrawalAmount,
            })
            const donorBalance = await ethers.provider.getBalance(this.alice.address)
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                amount: ETH_AMOUNT,
                disbursedAmount: ETH_AMOUNT.sub(withdrawalAmount),
            })
            const tx = await this.grants.connect(this.alice).withdrawDonation(donationId)
            const receipt = await tx.wait()
            const donation = await this.grants.donations(donationId)
            expect(donation.withdrawn).to.equal(true)
            await expect(tx).to.emit(this.grants, "WithdrawDonation").withArgs(donation)
            expect(await ethers.provider.getBalance(this.alice.address)).to.equal(
                donorBalance.sub(receipt.gasUsed.mul(receipt.effectiveGasPrice)).add(withdrawalAmount)
            )
        })
    })
    describe("grant proposals", function () {
        it("cannot be created by non-owner", async function () {
            const donationId = await setDonation(this.grants, this.defaultNativeDonation)
            await expect(
                this.grants.connect(this.eve).proposeGrant(donationId, this.eve.address, ETH_AMOUNT)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })
        it("fail if donation does not exist", async function () {
            await expect(this.grants.proposeGrant(404, this.eve.address, ETH_AMOUNT.mul(2))).to.be.revertedWith(
                "donation cannot cover full grant amount"
            )
        })
        it("fail if donation cannot cover full grant amount", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                amount: ETH_AMOUNT,
            })
            await expect(this.grants.proposeGrant(donationId, this.eve.address, ETH_AMOUNT.mul(2))).to.be.revertedWith(
                "donation cannot cover full grant amount"
            )
        })
        it("can be created by owner", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                amount: ETH_AMOUNT,
            })
            const grantCount = await this.grants.grantCount()
            const tx = await this.grants.connect(this.owner).proposeGrant(donationId, this.bob.address, ETH_AMOUNT)
            const grant = await this.grants.grants(grantCount)
            await expect(grant.donationId).to.equal(donationId)
            await expect(grant.recipient).to.equal(this.bob.address)
            await expect(grant.amount).to.equal(ETH_AMOUNT)
            await expect(grant.endorsed).to.equal(false)
            await expect(grant.disbursed).to.equal(false)
            await expect(grant.endorsedAt).to.equal(0)
            await expect(tx).to.emit(this.grants, "ProposeGrant").withArgs(grant)
        })
    })
    describe("single grant endorsements", function () {
        it("cannot be created by non-multisig accounts", async function () {
            const donationId = await setDonation(this.grants, this.defaultNativeDonation)
            await expect(this.grants.connect(this.eve).endorseGrant(donationId)).to.be.revertedWith(
                "caller is not the multisig"
            )
        })
        it("can be created by the multisig", async function () {
            const donationId = await setDonation(this.grants, this.defaultNativeDonation)
            const grantCount = await this.grants.grantCount()
            const tx = await this.grants.connect(this.multisig).endorseGrant(donationId)
            const grant = await this.grants.grants(grantCount)
            expect(grant.endorsed).to.equal(true)
            expect(grant.endorsedAt).to.equal(tx.blockNumber)
            await expect(tx).to.emit(this.grants, "EndorseGrant").withArgs(grant)
        })
    })
    describe("multiple grant endorsements", function () {
        it("cannot be created by non-multisig accounts", async function () {
            const [donationAId, donationBId] = [
                await setDonation(this.grants, this.defaultERC20Donation),
                await setDonation(this.grants, this.defaultNativeDonation),
            ]
            await expect(this.grants.connect(this.eve).endorseGrants([donationAId, donationBId])).to.be.revertedWith(
                "caller is not the multisig"
            )
        })
        it("can be created by the multisig", async function () {
            const [donationAId, donationBId] = [
                await setDonation(this.grants, this.defaultERC20Donation),
                await setDonation(this.grants, this.defaultNativeDonation),
            ]
            const grantCount = await this.grants.grantCount()
            const tx = await this.grants.connect(this.multisig).endorseGrants([donationAId, donationBId])
            const grantA = await this.grants.grants(grantCount)
            expect(grantA.endorsed).to.equal(true)
            expect(grantA.endorsedAt).to.equal(tx.blockNumber)
            await expect(tx).to.emit(this.grants, "EndorseGrant").withArgs(grantA)
            const grantB = await this.grants.grants(grantCount)
            expect(grantB.endorsed).to.equal(true)
            expect(grantB.endorsedAt).to.equal(tx.blockNumber)
            await expect(tx).to.emit(this.grants, "EndorseGrant").withArgs(grantB)
        })
    })
    describe("grant disbursal", function () {
        it("fails if grant has already been disbursed", async function () {
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                disbursed: true,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant has already been disbursed")
        })
        it("fails if grant does not exist", async function () {
            await expect(this.grants.disburseGrant(404)).to.be.revertedWith("grant has not been endorsed")
        })
        it("fails if donation does not exist", async function () {
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                donationId: 404,
                endorsed: true,
                endorsedAt: 0,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant amount exceeds donation balance")
        })
        it("fails if donation has been withdrawn", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultERC20Donation,
                withdrawn: true,
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                donationId,
                endorsed: true,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("donation has been withdrawn")
        })
        it("fails if grant has not been endorsed", async function () {
            const donationId = await setDonation(this.grants, this.defaultERC20Donation)
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                donationId,
                endorsed: false,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant has not been endorsed")
        })
        it("fails if donation grace period has not ended", async function () {
            const donationId = await setDonation(this.grants, this.defaultERC20Donation)
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                donationId,
                endorsed: true,
                endorsedAt: await ethers.provider.getBlockNumber(),
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("donation grace period has not ended")
        })
        it("fails if grant amount exceeds donation balance", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultERC20Donation,
                amount: ERC20_TOKEN_AMOUNT,
                disbursedAmount: ERC20_TOKEN_AMOUNT.div(2),
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                donationId,
                amount: ERC20_TOKEN_AMOUNT,
                endorsed: true,
                endorsedAt: 0,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant amount exceeds donation balance")
        })
        it("fails if native grant amount exceeds contract balance", async function () {
            const contractBalance = await ethers.provider.getBalance(this.grants.address)
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                amount: contractBalance.add(1),
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultNativeGrant,
                donationId,
                amount: contractBalance.add(1),
                endorsed: true,
                endorsedAt: (await ethers.provider.getBlockNumber()) - DONATION_GRACE_PERIOD,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("failed to disburse grant")
        })
        it("fails if ERC20 grant amount exceeds contract balance", async function () {
            const contractBalance = await this.testERC20.balanceOf(this.grants.address)
            const donationId = await setDonation(this.grants, {
                ...this.defaultERC20Donation,
                amount: contractBalance.add(1),
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                donationId,
                amount: contractBalance.add(1),
                endorsed: true,
                endorsedAt: (await ethers.provider.getBlockNumber()) - DONATION_GRACE_PERIOD,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance"
            )
        })
        it("transfers ERC20 grant amount to recipient", async function () {
            await this.testERC20.connect(this.alice).transfer(this.grants.address, ERC20_TOKEN_AMOUNT)
            const grantRecipientBalance = await this.testERC20.balanceOf(this.bob.address)
            const donationId = await setDonation(this.grants, this.defaultERC20Donation)
            const grantId = await setGrant(this.grants, {
                ...this.defaultERC20Grant,
                donationId,
                endorsed: true,
                endorsedAt: (await ethers.provider.getBlockNumber()) - DONATION_GRACE_PERIOD,
            })
            const tx = await this.grants.disburseGrant(grantId)
            const receipt = await tx.wait()
            const donation = await this.grants.donations(donationId)
            const grant = await this.grants.grants(grantId)
            expect(donation.disbursedAmount).to.equal(grant.amount)
            expect(grant.disbursed).to.equal(true)
            await expect(tx).to.emit(this.grants, "DisburseGrant").withArgs(grant)
            await expect(tx)
                .to.emit(this.testERC20, "Transfer")
                .withArgs(this.grants.address, this.bob.address, grant.amount)
            expect(await this.testERC20.balanceOf(this.bob.address)).to.equal(grantRecipientBalance.add(grant.amount))
        })
        it("transfers native grant amount to recipient", async function () {
            await this.alice.sendTransaction({
                to: this.grants.address,
                value: ETH_AMOUNT,
            })
            const grantRecipientBalance = await ethers.provider.getBalance(this.bob.address)
            const donationId = await setDonation(this.grants, {
                ...this.defaultNativeDonation,
                amount: ETH_AMOUNT,
                disbursedAmount: 0,
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultNativeGrant,
                donationId,
                amount: ETH_AMOUNT.div(2),
                endorsed: true,
                endorsedAt: (await ethers.provider.getBlockNumber()) - DONATION_GRACE_PERIOD,
            })
            const tx = await this.grants.disburseGrant(grantId)
            const receipt = await tx.wait()
            const donation = await this.grants.donations(donationId)
            const grant = await this.grants.grants(grantId)
            expect(donation.disbursedAmount).to.equal(grant.amount)
            expect(grant.disbursed).to.equal(true)
            await expect(tx).to.emit(this.grants, "DisburseGrant").withArgs(grant)
            expect(await ethers.provider.getBalance(this.bob.address)).to.equal(grantRecipientBalance.add(grant.amount))
        })
    })
})
