const { expect } = require("chai")
const { ethers } = require("hardhat")
const { smock } = require("@defi-wonderland/smock")

const TEST_DONATION_AMOUNT = ethers.BigNumber.from(100)
const TEST_GRACE_PERIOD = 10
const MAX_DONATION_GRACE_PERIOD = 10

const whitelistDonor = (contract, donor) => {
    return contract.setVariable("donorWhitelisted", {
        [donor]: true,
    })
}

const setDonation = async (contract, donation, id) => {
    const donationId = id || (await contract.donationCount())
    await contract.setVariable("donationCount", donationId + 1)
    await contract.setVariable("donations", {
        [donationId]: donation,
    })
    return donationId
}

const setGrant = async (contract, grant, id) => {
    const grantId = id || (await contract.grantCount())
    await contract.setVariable("grantCount", grantId + 1)
    await contract.setVariable("grants", {
        [grantId]: grant,
    })
    return grantId
}

const retire = async (contract) => {
    await contract.setVariable("retired", true)
}

describe("DisintermediatedGrants", function () {
    before(async function () {
        const [deployer, multisig, alice, bob, eve] = await ethers.getSigners()
        this.deployer = deployer
        this.multisig = multisig
        this.alice = alice
        this.bob = bob
        this.eve = eve
        this.parties = [alice, bob, eve]
        this.DisintermediatedGrantsFactory = await smock.mock("DisintermediatedGrants")
        this.TestERC20Factory = await ethers.getContractFactory("TestERC20")
    })
    beforeEach(async function () {
        this.DisintermediatedGrants = await this.DisintermediatedGrantsFactory.connect(this.deployer).deploy(
            this.multisig.address,
            MAX_DONATION_GRACE_PERIOD
        )
        this.dg = await this.DisintermediatedGrants.deployed()
        this.TestERC20 = await this.TestERC20Factory.deploy()
        this.token = await this.TestERC20.deployed()
        this.parties.forEach(async (party) => {
            await this.token.connect(party).mint(TEST_DONATION_AMOUNT)
        })
        this.whitelistDonor = (donor) => whitelistDonor(this.dg, donor)
        this.setDonation = (donation, id) => setDonation(this.dg, donation, id)
        this.setGrant = (grant, id) => setGrant(this.dg, grant, id)
        this.retire = () => retire(this.dg)
        this.defaultDonation = {
            donor: this.alice.address,
            token: this.token.address,
            gracePeriod: 10,
        }
        this.defaultGrant = {
            donationId: 0,
            recipient: this.bob.address,
            amount: TEST_DONATION_AMOUNT,
            disbursed: false,
            proposedAt: await ethers.provider.getBlockNumber(),
        }
    })
    describe("donors", function () {
        it("cannot be whitelisted by non-multisig", async function () {
            expect(await this.dg.donorWhitelisted(this.alice.address)).to.equal(false)
            await expect(this.dg.connect(this.eve).whitelistDonor(this.eve.address)).to.be.revertedWith(
                "caller is not the multisig"
            )
        })
        it("cannot be whitelisted if contract has retired", async function () {
            await this.retire()
            await expect(this.dg.connect(this.multisig).whitelistDonor(this.alice.address)).to.be.revertedWith(
                "contract has retired"
            )
        })
        it("can be whitelisted by multisig", async function () {
            expect(await this.dg.donorWhitelisted(this.alice.address)).to.equal(false)
            const tx = await this.dg.connect(this.multisig).whitelistDonor(this.alice.address)
            await expect(tx).to.emit(this.dg, "WhitelistDonor").withArgs(this.alice.address)
            expect(await this.dg.donorWhitelisted(this.alice.address)).to.equal(true)
        })
    })
    describe("donations", function () {
        it("cannot be made by non-whitelisted donors", async function () {
            await expect(
                this.dg.connect(this.eve).donate(this.token.address, TEST_DONATION_AMOUNT, TEST_GRACE_PERIOD)
            ).to.be.revertedWith("caller is not whitelisted donor")
        })
        it("fail if donor balance cannot cover commitment", async function () {
            await this.whitelistDonor(this.alice.address)
            const donorBalance = await this.token.balanceOf(this.alice.address)
            const donationAmount = donorBalance.add(1)
            await this.token.connect(this.alice).approve(this.dg.address, donationAmount)
            await expect(
                this.dg.connect(this.alice).donate(this.token.address, donationAmount, TEST_GRACE_PERIOD)
            ).to.be.revertedWith("insufficient balance to cover commitment amount")
        })
        it("fail if donor allowance cannot cover commitment", async function () {
            await this.whitelistDonor(this.alice.address)
            const donorBalance = await this.token.balanceOf(this.alice.address)
            await this.token.connect(this.alice).approve(this.dg.address, donorBalance.sub(1))
            await expect(
                this.dg.connect(this.alice).donate(this.token.address, donorBalance, TEST_GRACE_PERIOD)
            ).to.be.revertedWith("insufficient allowance to cover commitment amount")
        })
        it("can be made by whitelisted donors", async function () {
            const initialDonorBalance = await this.token.balanceOf(this.alice.address)
            await this.whitelistDonor(this.alice.address)
            await this.token.connect(this.alice).approve(this.dg.address, TEST_DONATION_AMOUNT)
            const donationCount = await this.dg.donationCount()
            const tx = await this.dg
                .connect(this.alice)
                .donate(this.token.address, TEST_DONATION_AMOUNT, TEST_GRACE_PERIOD)
            const donation = await this.dg.donations(donationCount)
            await expect(tx).to.emit(this.dg, "Donate").withArgs(TEST_DONATION_AMOUNT, donation)
            expect(donation.donor).to.equal(this.alice.address)
            expect(donation.token).to.equal(this.token.address)
            expect(donation.gracePeriod).to.equal(TEST_GRACE_PERIOD)
            expect(await this.token.allowance(donation.donor, this.dg.address)).to.equal(TEST_DONATION_AMOUNT)
            expect(await this.token.balanceOf(this.alice.address)).to.equal(initialDonorBalance)
        })
        it("fail if commitment is zero", async function () {
            await this.whitelistDonor(this.alice.address)
            const donationCount = await this.dg.donationCount()
            await expect(
                this.dg.connect(this.alice).donate(this.token.address, 0, TEST_GRACE_PERIOD)
            ).to.be.revertedWith("commitment amount cannot be zero")
        })
        it("fail if grace period is too long", async function () {
            await this.whitelistDonor(this.alice.address)
            const donationCount = await this.dg.donationCount()
            await expect(
                this.dg
                    .connect(this.alice)
                    .donate(this.token.address, TEST_DONATION_AMOUNT, (await this.dg.maxDonationGracePeriod()) + 1)
            ).to.be.revertedWith("withdrawal grace period is too long")
        })
        it("fail if contract has retired", async function () {
            await this.retire()
            await expect(
                this.dg.connect(this.alice).donate(this.token.address, TEST_DONATION_AMOUNT, TEST_GRACE_PERIOD)
            ).to.be.revertedWith("contract has retired")
        })
    })
    describe("grant proposals", function () {
        it("cannot be created by non-multisig", async function () {
            const donationId = await this.setDonation(this.defaultDonation)
            await expect(
                this.dg.connect(this.eve).proposeGrant({
                    donationId,
                    recipient: this.eve.address,
                    amount: TEST_DONATION_AMOUNT,
                })
            ).to.be.revertedWith("caller is not the multisig")
        })
        it("fail if donation does not exist", async function () {
            await expect(
                this.dg.connect(this.multisig).proposeGrant({
                    donationId: 404,
                    recipient: this.eve.address,
                    amount: TEST_DONATION_AMOUNT,
                })
            ).to.be.revertedWith("donation does not exist")
        })
        it("can be created by multisig", async function () {
            const donationId = await this.setDonation(this.defaultDonation)
            const grantCount = await this.dg.grantCount()
            const tx = await this.dg.connect(this.multisig).proposeGrant({
                donationId,
                recipient: this.bob.address,
                amount: TEST_DONATION_AMOUNT,
            })
            const grant = await this.dg.grants(grantCount)
            await expect(grant.donationId).to.equal(donationId)
            await expect(grant.recipient).to.equal(this.bob.address)
            await expect(grant.amount).to.equal(TEST_DONATION_AMOUNT)
            await expect(grant.disbursed).to.equal(false)
            await expect(grant.proposedAt).to.equal(tx.blockNumber)
            await expect(tx).to.emit(this.dg, "ProposeGrant").withArgs(grant)
        })
        it("fail if contract has retired", async function () {
            await this.retire()
            const donationId = await this.setDonation(this.defaultDonation)
            await expect(
                this.dg.connect(this.multisig).proposeGrant({
                    donationId,
                    recipient: this.bob.address,
                    amount: TEST_DONATION_AMOUNT,
                })
            ).to.be.revertedWith("contract has retired")
        })
    })
    describe("multiple grant proposals", function () {
        beforeEach(async function () {
            const [donationAId, donationBId] = [
                await this.setDonation(this.defaultDonation),
                await this.setDonation(this.defaultDonation),
            ]

            const [grantAProposal, grantBProposal] = [
                {
                    donationId: donationAId,
                    recipient: this.bob.address,
                    amount: TEST_DONATION_AMOUNT,
                },
                {
                    donationId: donationBId,
                    recipient: this.bob.address,
                    amount: TEST_DONATION_AMOUNT,
                },
            ]

            this.grantAProposal = grantAProposal
            this.grantBProposal = grantBProposal
        })
        it("cannot be created by non-multisig accounts", async function () {
            await expect(
                this.dg.connect(this.eve).proposeGrants([this.grantAProposal, this.grantBProposal])
            ).to.be.revertedWith("caller is not the multisig")
        })
        it("can be created by multisig", async function () {
            const grantCount = await this.dg.grantCount()
            const tx = await this.dg.connect(this.multisig).proposeGrants([this.grantAProposal, this.grantBProposal])
            const grantA = await this.dg.grants(grantCount)
            expect(grantA.proposedAt).to.equal(tx.blockNumber)
            await expect(tx).to.emit(this.dg, "ProposeGrant").withArgs(grantA)
            const grantB = await this.dg.grants(grantCount + 1)
            expect(grantB.proposedAt).to.equal(tx.blockNumber)
            await expect(tx).to.emit(this.dg, "ProposeGrant").withArgs(grantB)
        })
    })
    describe("grant disbursals", function () {
        it("fail if grant has already been disbursed", async function () {
            const grantId = await this.setGrant({
                ...this.defaultGrant,
                disbursed: true,
            })
            await expect(this.dg.connect(this.bob).disburseGrant(grantId)).to.be.revertedWith(
                "grant has already been disbursed"
            )
        })
        it("fail if grant does not exist", async function () {
            await expect(this.dg.connect(this.bob).disburseGrant(404)).to.be.revertedWith("grant does not exist")
        })
        it("fail if donation does not exist", async function () {
            const grantId = await this.setGrant({
                ...this.defaultGrant,
                donationId: 404,
                proposedAt: 0,
            })
            await expect(this.dg.connect(this.bob).disburseGrant(grantId)).to.be.revertedWith("donation does not exist")
        })
        it("fail if donation grace period has not ended", async function () {
            const donationId = await this.setDonation(this.defaultDonation)
            const grantId = await this.setGrant({
                ...this.defaultGrant,
                donationId,
                proposedAt: await ethers.provider.getBlockNumber(),
            })
            await expect(this.dg.connect(this.bob).disburseGrant(grantId)).to.be.revertedWith(
                "donation grace period has not ended"
            )
        })
        it("fail if donor has removed allowance", async function () {
            const donationId = await this.setDonation(this.defaultDonation)
            await this.token.connect(this.alice).approve(this.dg.address, 0)
            const grantId = await this.setGrant({
                ...this.defaultGrant,
                donationId,
                amount: TEST_DONATION_AMOUNT,
                proposedAt: (await ethers.provider.getBlockNumber()) - this.defaultDonation.gracePeriod,
            })
            await expect(this.dg.disburseGrant(grantId)).to.be.revertedWith("insufficient donor allowance")
        })
        it("fail if donation exceeds donor balance", async function () {
            const donorBalance = await this.token.balanceOf(this.alice.address)
            await this.token.connect(this.alice).approve(this.dg.address, donorBalance)
            const donationId = await this.setDonation(this.defaultDonation)
            await this.token.connect(this.alice).transfer(this.bob.address, donorBalance)
            const grantId = await this.setGrant({
                ...this.defaultGrant,
                donationId,
                amount: donorBalance,
                proposedAt: (await ethers.provider.getBlockNumber()) - this.defaultDonation.gracePeriod,
            })
            await expect(this.dg.connect(this.bob).disburseGrant(grantId)).to.be.revertedWith(
                "insufficient donor balance"
            )
        })
        it("transfer grant amount to recipient", async function () {
            await this.token.connect(this.alice).approve(this.dg.address, TEST_DONATION_AMOUNT)
            const grantRecipientBalance = await this.token.balanceOf(this.bob.address)
            const donationId = await this.setDonation(this.defaultDonation)
            const grantId = await this.setGrant({
                ...this.defaultGrant,
                donationId,
                proposedAt: (await ethers.provider.getBlockNumber()) - this.defaultDonation.gracePeriod,
            })
            const tx = await this.dg.connect(this.bob).disburseGrant(grantId)
            const receipt = await tx.wait()
            const donation = await this.dg.donations(donationId)
            const grant = await this.dg.grants(grantId)
            expect(grant.disbursed).to.equal(true)
            await expect(tx).to.emit(this.dg, "DisburseGrant").withArgs(grant)
            await expect(tx)
                .to.emit(this.token, "Transfer")
                .withArgs(this.alice.address, this.bob.address, grant.amount)
            expect(await this.token.balanceOf(this.bob.address)).to.equal(grantRecipientBalance.add(grant.amount))
        })
    })
    describe("retirement", function () {
        it("cannot be imposed by non-multisig", async function () {
            await expect(this.dg.connect(this.eve).retire()).to.be.revertedWith("caller is not the multisig")
        })
        it("can be imposed by multisig", async function () {
            await this.dg.connect(this.multisig).retire()
            expect(await this.dg.retired()).to.equal(true)
        })
    })
    describe("native transfers", function () {
        it("not permitted", async function () {
            await expect(
                this.alice.sendTransaction({
                    to: this.dg.address,
                    value: ethers.BigNumber.from(100),
                })
            ).to.be.revertedWith("deposits not permitted")
        })
    })
})
