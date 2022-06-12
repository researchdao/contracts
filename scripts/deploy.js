require("dotenv").config()

async function main() {
    const [deployer] = await ethers.getSigners()

    const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS
    const MAX_DONATION_GRACE_PERIOD = process.env.MAX_DONATION_GRACE_PERIOD

    console.log("Deploying contracts with the account:", deployer.address)
    console.log("Account balance:", (await deployer.getBalance()).toString())

    console.log("Multisig address:", MULTISIG_ADDRESS)
    console.log("Maximum donation grace period (in blocks):", MAX_DONATION_GRACE_PERIOD)

    const DisintermediatedGrants = await ethers.getContractFactory("DisintermediatedGrants")
    const disintermediatedGrants = await DisintermediatedGrants.deploy(MULTISIG_ADDRESS, MAX_DONATION_GRACE_PERIOD)

    console.log("DisintermediatedGrants address:", disintermediatedGrants.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
