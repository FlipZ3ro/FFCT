const { Telegraf, Markup } = require("telegraf");
const { Web3 } = require("web3");

// Hardcoded Environment Variables
const BOT_TOKEN = "TOKEN";
const RPC_URL = "https://testnet-rpc.monad.xyz";
const PRIVATE_KEY = "pk";

const TELEGRAM_CHANNELS = ["NAME CHANNEL", "NAME CHANNEL"];

const web3 = new Web3(RPC_URL);
const bot = new Telegraf(BOT_TOKEN);

// Validate Private Key
let sanitizedPrivateKey = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY.slice(2) : PRIVATE_KEY;
if (sanitizedPrivateKey.length !== 64) {
  console.error("❌ Invalid PRIVATE_KEY format");
  process.exit(1);
}

const faucetAccount = web3.eth.accounts.privateKeyToAccount("0x" + sanitizedPrivateKey);
web3.eth.accounts.wallet.add(faucetAccount);
console.log("✅ Faucet Address:", faucetAccount.address);

const userClaims = new Map(); // Store user claim timestamps
const claimedAddresses = new Map(); // Store claimed wallet addresses
const userStates = new Map(); // Track user states (e.g., awaiting wallet input)

// Start command with menu
bot.start(async (ctx) => {
  ctx.reply(
    "🚰 Welcome to Monad x Empire Testnet Faucet!\nBefore claiming, please join our Telegram channels.",
    Markup.inlineKeyboard([
      ...TELEGRAM_CHANNELS.map((channel) => [Markup.button.url(`Join ${channel}`, `https://t.me/${channel.slice(1)}`)]),
      [Markup.button.callback("✅ Check Membership", "check_membership")],
    ])
  );
});

// Check Telegram Membership
bot.action("check_membership", async (ctx) => {
  const userId = ctx.from.id;
  try {
    for (const channel of TELEGRAM_CHANNELS) {
      const member = await ctx.telegram.getChatMember(channel, userId);
      if (!(member.status === "member" || member.status === "administrator" || member.status === "creator")) {
        return ctx.reply(`❌ You need to join ${channel} first!`);
      }
    }
    ctx.reply(
      "✅ You are a member of all required channels! Now, send your wallet address to claim faucet.",
      Markup.inlineKeyboard([Markup.button.callback("💰 Claim Faucet", "claim_faucet")])
    );
  } catch (error) {
    ctx.reply("❌ Error checking membership. Make sure the bot is an admin in the channels.");
  }
});

// Claim Faucet - Ask for Wallet Address
bot.action("claim_faucet", async (ctx) => {
  const userId = ctx.from.id;
  userStates.set(userId, "awaiting_wallet"); // Set state to awaiting wallet
  ctx.reply("📩 Send me your wallet address to receive Monad Testnet MON.");
});

// Receive wallet address & Process Transaction
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const userAddress = ctx.message.text.trim();

  // Only process input if user is in wallet submission state
  if (userStates.get(userId) !== "awaiting_wallet") {
    return; // Ignore other messages
  }

  userStates.delete(userId); // Reset state after receiving input

  // Validate wallet address
  if (!web3.utils.isAddress(userAddress)) {
    return ctx.reply("❌ Invalid wallet address. Please enter a valid Ethereum address.");
  }

  const now = Date.now();
  const lastClaimTime = userClaims.get(userId);
  const lastClaimForAddress = claimedAddresses.get(userAddress);

  // Cek apakah user sudah klaim dalam 24 jam terakhir
  if (lastClaimTime && now - lastClaimTime < 24 * 60 * 60 * 1000) {
    const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (now - lastClaimTime)) / (60 * 60 * 1000));
    return ctx.reply(`❌ You can only claim once every 24 hours. Please try again in ${hoursLeft} hours.`);
  }

  // Cek apakah address sudah pernah diklaim dalam 24 jam terakhir
  if (lastClaimForAddress && now - lastClaimForAddress < 24 * 60 * 60 * 1000) {
    return ctx.reply("❌ This wallet address has already been used to claim within the last 24 hours.");
  }

  try {
    const amount = web3.utils.toWei("0.05", "ether");
    const pendingTx = await web3.eth.getTransactionCount(faucetAccount.address, "pending");
    const latestTx = await web3.eth.getTransactionCount(faucetAccount.address, "latest");

    if (pendingTx > latestTx) {
      return ctx.reply("❌ Masih ada transaksi pending. Harap tunggu beberapa saat.");
    }

    const nonce = latestTx;
    const gasPrice = web3.utils.toWei("70", "gwei");
    const gasLimit = await web3.eth.estimateGas({ to: userAddress, value: amount });

    const tx = {
      from: faucetAccount.address,
      to: userAddress,
      value: amount,
      gas: gasLimit,
      gasPrice: gasPrice,
      nonce: nonce,
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, "0x" + sanitizedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction, { transactionConfirmationBlocks: 100 });

    // Simpan waktu klaim user dan address
    userClaims.set(userId, now);
    claimedAddresses.set(userAddress, now);

    ctx.reply(`✅ Sent 0.05 MON to ${userAddress}\n🔗 Tx: https://testnet.monadexplorer.com/tx/${receipt.transactionHash}`);
  } catch (error) {
    console.error("❌ Faucet Error:", error);
    let errorMessage = "❌ Transaction failed. Try again later.";
    if (error.message.includes("Nonce too low")) {
      errorMessage = "❌ Nonce terlalu rendah. Tunggu transaksi sebelumnya selesai atau coba lagi nanti.";
    } else if (error.message.includes("insufficient funds")) {
      errorMessage = "❌ Faucet kehabisan dana. Mohon tunggu pengisian ulang.";
    } else if (error.message.includes("not mined within 50 blocks")) {
      errorMessage = "❌ Transaksi memakan waktu lama. Silakan cek explorer untuk statusnya.";
    }
    ctx.reply(errorMessage);
  }
});

bot.launch().then(() => {
  console.log("🤖 Telegram Faucet Bot is running...");
});

// Error Handling
process.on("uncaughtException", (err) => {
  console.error("🚨 Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection:", reason);
});
