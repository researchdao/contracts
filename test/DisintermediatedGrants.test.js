const { expect } = require("chai")
const { ethers } = require("hardhat")
const { smock } = require("@defi-wonderland/smock")

const DONATION_GRACE_PERIOD = 10
const TEST_DONATION_AMOUNT = ethers.BigNumber.from(100)

const whitelistDonor = (contract, donor) => {
    return contract.setVariable("donorWhitelisted", {
        [donor]: true,
    })
}

const setDonation = async (contract, donation, id) => {
    const donationId = id || (await contract.donationCount())
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
        this.token = await this.TestERC20.deploy()
        await this.token.deployed()
        this.parties.forEach(async (party) => {
            await this.token.connect(party).mint(TEST_DONATION_AMOUNT)
        })
        this.defaultDonation = {
            donor: this.alice.address,
            token: this.token.address,
            amount: TEST_DONATION_AMOUNT,
            disbursedAmount: 0,
            withdrawn: false,
        }
        this.defaultGrant = {
            donationId: 0,
            recipient: this.bob.address,
            amount: TEST_DONATION_AMOUNT,
            endorsed: false,
            disbursed: false,
            endorsedAt: await ethers.provider.getBlockNumber(),
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
    describe("donations", function () {
        it("cannot be made by non-whitelisted donors", async function () {
            await expect(
                this.grants.connect(this.eve).donate(this.token.address, TEST_DONATION_AMOUNT)
            ).to.be.revertedWith("caller is not whitelisted donor")
        })
        it("fail if donation amount exceeds donor balance", async function () {
            await whitelistDonor(this.grants, this.alice.address)
            const donorBalance = await this.token.balanceOf(this.alice.address)
            const donationAmount = donorBalance.add(1)
            await this.token.connect(this.alice).approve(this.grants.address, donationAmount)
            await expect(this.grants.connect(this.alice).donate(this.token.address, donationAmount)).to.be.revertedWith(
                "donation amount exceeds balance"
            )
        })
        it("cannot be made with insufficient allowance", async function () {
            await whitelistDonor(this.grants, this.alice.address)
            const donorBalance = await this.token.balanceOf(this.alice.address)
            await this.token.connect(this.alice).approve(this.grants.address, donorBalance.sub(1))
            await expect(this.grants.connect(this.alice).donate(this.token.address, donorBalance)).to.be.revertedWith(
                "insufficient donation amount allowance"
            )
        })
        it("can be made by whitelisted donors", async function () {
            const initialDonorBalance = await this.token.balanceOf(this.alice.address)
            await whitelistDonor(this.grants, this.alice.address)
            await this.token.connect(this.alice).approve(this.grants.address, TEST_DONATION_AMOUNT)
            const donationCount = await this.grants.donationCount()
            const tx = await this.grants.connect(this.alice).donate(this.token.address, TEST_DONATION_AMOUNT)
            const donation = await this.grants.donations(donationCount)
            await expect(tx).to.emit(this.grants, "Donate").withArgs(donation)
            expect(donation.donor).to.equal(this.alice.address)
            expect(donation.token).to.equal(this.token.address)
            expect(donation.amount).to.equal(TEST_DONATION_AMOUNT)
            expect(donation.disbursedAmount).to.equal(0)
            expect(donation.withdrawn).to.equal(false)
            expect(await this.token.allowance(donation.donor, this.grants.address)).to.equal(TEST_DONATION_AMOUNT)
            expect(await this.token.balanceOf(this.alice.address)).to.equal(initialDonorBalance)
        })
        it("fail if donation amount is zero", async function () {
            await whitelistDonor(this.grants, this.alice.address)
            const donationCount = await this.grants.donationCount()
            await expect(this.grants.connect(this.alice).donate(this.token.address, 0)).to.be.revertedWith(
                "donation amount cannot be zero"
            )
        })
    })
    describe("donation withdrawal", function () {
        before(async function () {
            await whitelistDonor(this.grants, this.alice.address)
        })
        it("fails if already withdrawn", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                withdrawn: true,
            })
            await expect(this.grants.connect(this.alice).withdrawDonation(donationId)).to.be.revertedWith(
                "donation has already been withdrawn"
            )
        })
        it("fails if caller is not the donor", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                donor: this.alice.address,
            })
            await expect(this.grants.connect(this.eve).withdrawDonation(donationId)).to.be.revertedWith(
                "caller is not donor"
            )
        })
        it("fails for fully disbursed donations", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                disbursedAmount: TEST_DONATION_AMOUNT,
            })
            await expect(this.grants.connect(this.alice).withdrawDonation(donationId)).to.be.revertedWith(
                "donation has been fully disbursed"
            )
        })
        it("withdraws donation", async function () {
            const withdrawalAmount = this.defaultDonation.amount.div(2)
            await this.token.connect(this.alice).approve(this.grants.address, this.defaultDonation.amount)
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                donor: this.alice.address,
                disbursedAmount: this.defaultDonation.amount.sub(withdrawalAmount),
            })
            const tx = await this.grants.connect(this.alice).withdrawDonation(donationId)
            const donation = await this.grants.donations(donationId)
            expect(donation.withdrawn).to.equal(true)
            await expect(tx).to.emit(this.grants, "WithdrawDonation").withArgs(donation)
        })
    })
    describe("grant proposals", function () {
        it("cannot be created by non-owner", async function () {
            const donationId = await setDonation(this.grants, this.defaultDonation)
            await expect(
                this.grants.connect(this.eve).proposeGrant(donationId, this.eve.address, TEST_DONATION_AMOUNT)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })
        it("fail if donation does not exist", async function () {
            await expect(
                this.grants.proposeGrant(404, this.eve.address, TEST_DONATION_AMOUNT)
            ).to.be.revertedWith("donation cannot cover full grant amount")
        })
        it("fail if donation cannot cover full grant amount", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                amount: TEST_DONATION_AMOUNT,
            })
            await expect(
                this.grants.proposeGrant(donationId, this.eve.address, TEST_DONATION_AMOUNT.mul(2))
            ).to.be.revertedWith("donation cannot cover full grant amount")
        })
        it("can be created by owner", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                amount: TEST_DONATION_AMOUNT,
            })
            const grantCount = await this.grants.grantCount()
            const tx = await this.grants
                .connect(this.owner)
                .proposeGrant(donationId, this.bob.address, TEST_DONATION_AMOUNT)
            const grant = await this.grants.grants(grantCount)
            await expect(grant.donationId).to.equal(donationId)
            await expect(grant.recipient).to.equal(this.bob.address)
            await expect(grant.amount).to.equal(TEST_DONATION_AMOUNT)
            await expect(grant.endorsed).to.equal(false)
            await expect(grant.disbursed).to.equal(false)
            await expect(grant.endorsedAt).to.equal(0)
            await expect(tx).to.emit(this.grants, "ProposeGrant").withArgs(grant)
        })
    })
    describe("single grant endorsements", function () {
        it("cannot be created by non-multisig accounts", async function () {
            const donationId = await setDonation(this.grants, this.defaultDonation)
            await expect(this.grants.connect(this.eve).endorseGrant(donationId)).to.be.revertedWith(
                "caller is not the multisig"
            )
        })
        it("can be created by the multisig", async function () {
            const donationId = await setDonation(this.grants, this.defaultDonation)
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
                await setDonation(this.grants, this.defaultDonation),
                await setDonation(this.grants, this.defaultDonation),
            ]
            await expect(this.grants.connect(this.eve).endorseGrants([donationAId, donationBId])).to.be.revertedWith(
                "caller is not the multisig"
            )
        })
        it("can be created by the multisig", async function () {
            const [donationAId, donationBId] = [
                await setDonation(this.grants, this.defaultDonation),
                await setDonation(this.grants, this.defaultDonation),
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
                ...this.defaultGrant,
                disbursed: true,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant has already been disbursed")
        })
        it("fails if grant does not exist", async function () {
            await expect(this.grants.disburseGrant(404)).to.be.revertedWith("grant has not been endorsed")
        })
        it("fails if donation does not exist", async function () {
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
                donationId: 404,
                endorsed: true,
                endorsedAt: 0,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant amount exceeds donation balance")
        })
        it("fails if donation has been withdrawn", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                withdrawn: true,
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
                donationId,
                endorsed: true,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("donation has been withdrawn")
        })
        it("fails if grant has not been endorsed", async function () {
            const donationId = await setDonation(this.grants, this.defaultDonation)
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
                donationId,
                endorsed: false,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant has not been endorsed")
        })
        it("fails if donation grace period has not ended", async function () {
            const donationId = await setDonation(this.grants, this.defaultDonation)
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
                donationId,
                endorsed: true,
                endorsedAt: await ethers.provider.getBlockNumber(),
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("donation grace period has not ended")
        })
        it("fails if grant amount exceeds donation balance", async function () {
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                amount: TEST_DONATION_AMOUNT,
                disbursedAmount: TEST_DONATION_AMOUNT.div(2),
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
                donationId,
                amount: TEST_DONATION_AMOUNT,
                endorsed: true,
                endorsedAt: 0,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("grant amount exceeds donation balance")
        })
        it("fails if donor has removed allowance", async function () {
            await this.token.connect(this.alice).approve(this.grants.address, 0)
            const donationId = await setDonation(this.grants, {
                ...this.defaultDonation,
                amount: TEST_DONATION_AMOUNT,
            })
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
                donationId,
                amount: TEST_DONATION_AMOUNT,
                endorsed: true,
                endorsedAt: (await ethers.provider.getBlockNumber()) - DONATION_GRACE_PERIOD,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith("donor has removed allowance")
        })
        it("fails if donation exceeds donor balance", async function () {
            const donorBalance = await this.token.balanceOf(this.alice.address)
            await this.token.connect(this.alice).approve(this.grants.address, donorBalance)
            const donationId = await setDonation(this.grants, this.defaultDonation)
            await this.token.connect(this.alice).transfer(this.bob.address, donorBalance)
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
                donationId,
                amount: TEST_DONATION_AMOUNT,
                endorsed: true,
                endorsedAt: (await ethers.provider.getBlockNumber()) - DONATION_GRACE_PERIOD,
            })
            await expect(this.grants.disburseGrant(grantId)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance"
            )
        })
        it("transfers grant amount to recipient", async function () {
            await this.token.connect(this.alice).approve(this.grants.address, TEST_DONATION_AMOUNT)
            const grantRecipientBalance = await this.token.balanceOf(this.bob.address)
            const donationId = await setDonation(this.grants, this.defaultDonation)
            const grantId = await setGrant(this.grants, {
                ...this.defaultGrant,
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
                .to.emit(this.token, "Transfer")
                .withArgs(this.alice.address, this.bob.address, grant.amount)
            expect(await this.token.balanceOf(this.bob.address)).to.equal(grantRecipientBalance.add(grant.amount))
        })
    })
    describe("native transfers", function () {
        it("not permitted", async function () {
            await expect(
                this.alice.sendTransaction({
                    to: this.grants.address,
                    value: ethers.BigNumber.from(100),
                })
            ).to.be.reverted
        })
    })
})
