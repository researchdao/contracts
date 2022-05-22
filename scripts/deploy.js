require('dotenv').config()

async function main() {
    const [deployer] = await ethers.getSigners()

    console.log("Deploying contracts with the account:", deployer.address)
    console.log("Account balance:", (await deployer.getBalance()).toString())

    const DisintermediatedGrants = await ethers.getContractFactory("DisintermediatedGrants")
    const disintermediatedGrants = await DisintermediatedGrants.deploy(process.env.MULTISIG_ADDRESS, process.env.GRACE_PERIOD)

    console.log("DisintermediatedGrants address:", disintermediatedGrants.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })