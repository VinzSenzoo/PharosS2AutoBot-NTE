import blessed from "blessed";
import chalk from "chalk";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

const RPC_URL = "https://testnet.dplabs-internal.com";
const PHRS_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const WPHRS_ADDRESS = "0x3019b247381c850ab53dc0ee53bce7a07ea9155f";
const USDT_ADDRESS = "0xd4071393f8716661958f766df660033b3d35fd29";
const ROUTER_ADDRESS = "0x3541423f25a1ca5c98fdbcf478405d3f0aad1164";
const LP_ADDRESS = "0x4b177aded3b8bd1d5d747f91b9e853513838cd49";
const TIP_ADDRESS = "0xD17512B7EC12880Bd94Eca9d774089fF89805F02";
const AQUAFLUX_NFT_ADDRESS = "0xCc8cF44E196CaB28DBA2d514dc7353af0eFb370E";
const API_BASE_URL = "https://api.pharosnetwork.xyz";
const FAUCET_USDT_URL = "https://testnet-router.zenithswap.xyz/api/v1/faucet";
const AQUAFLUX_BASE_URL = "https://api.aquaflux.pro/api/v1/users/wallet-login";
const CONFIG_FILE = "config.json";
const isDebug = false;

let walletInfo = {
  address: "N/A",
  balancePHRS: "0.00",
  balanceWPHRS: "0.00",
  balanceUSDT: "0.00",
  activeAccount: "N/A",
  cycleCount: 0,
  nextCycle: "N/A"
};
let transactionLogs = [];
let activityRunning = false;
let isCycleRunning = false;
let shouldStop = false;
let dailyActivityInterval = null;
let privateKeys = [];
let proxies = [];
let selectedWalletIndex = 0;
let loadingSpinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const borderBlinkColors = ["cyan", "blue", "magenta", "red", "yellow", "green"];
let borderBlinkIndex = 0;
let blinkCounter = 0;
let spinnerIndex = 0;
let nonceTracker = {};
let hasLoggedSleepInterrupt = false;
let accountJwts = {};
let isHeaderRendered = false;
let activeProcesses = 0;

let dailyActivityConfig = {
  swapRepetitions: 10,
  sendPhrsRepetitions: 10,
  addLiquidityRepetitions: 10,
  tipRepetitions: 1,
  minTipAmount: 0.001,
  maxTipAmount: 0.003,
  mintRepetitions: 1 
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const ROUTER_ABI = [
  "function mixSwap(address fromToken, address toToken, uint256 fromAmount, uint256 resAmount, uint256 minReturnAmount, address[] memory proxyList, address[] memory poolList, address[] memory routeList, uint256 direction, bytes[] memory moreInfos, uint256 deadLine) external payable returns (uint256)"
];

const LP_ABI = [
  "function addDVMLiquidity(address dvmAddress, uint256 baseInAmount, uint256 quoteInAmount, uint256 baseMinAmount, uint256 quoteMinAmount, uint8 flag, uint256 deadLine) external payable returns (uint256, uint256, uint256)"
];

const TIP_ABI = [
  "function tip(tuple(uint32,address) token, tuple(string,string,uint256,uint256[]) recipient) external"
];

const AQUAFLUX_NFT_ABI = [
  "function claimTokens() external",
  "function combineCS(uint256 amount) external",
  "function combinePC(uint256 amount) external",
  "function combinePS(uint256 amount) external",
  "function hasClaimedStandardNFT(address owner) view returns (bool)",
  "function mint(uint8 nftType, uint256 expiresAt, bytes signature) external"
];

function getTokenName(tokenAddress) {
  if (tokenAddress === PHRS_ADDRESS) return "PHRS";
  if (tokenAddress === WPHRS_ADDRESS) return "WPHRS";
  if (tokenAddress === USDT_ADDRESS) return "USDT";
  return "Unknown";
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      const config = JSON.parse(data);
      dailyActivityConfig.swapRepetitions = Number(config.swapRepetitions) || 10;
      dailyActivityConfig.sendPhrsRepetitions = Number(config.sendPhrsRepetitions) || 10;
      dailyActivityConfig.addLiquidityRepetitions = Number(config.addLiquidityRepetitions) || 10;
      dailyActivityConfig.tipRepetitions = Number(config.tipRepetitions) || 1;
      dailyActivityConfig.minTipAmount = Number(config.minTipAmount) || 0.001;
      dailyActivityConfig.maxTipAmount = Number(config.maxTipAmount) || 0.003;
      dailyActivityConfig.mintRepetitions = Number(config.mintRepetitions) || 1;
      addLog(`Loaded config: Auto Swap = ${dailyActivityConfig.swapRepetitions}, Auto Send PHRS = ${dailyActivityConfig.sendPhrsRepetitions}, Auto Add LP = ${dailyActivityConfig.addLiquidityRepetitions}, Auto Tip = ${dailyActivityConfig.tipRepetitions}, Auto Mint = ${dailyActivityConfig.mintRepetitions}`, "success");
    } else {
      addLog("No config file found, using default settings.", "info");
    }
  } catch (error) {
    addLog(`Failed to load config: ${error.message}, using default settings.`, "error");
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(dailyActivityConfig, null, 2));
    addLog("Configuration saved successfully.", "success");
  } catch (error) {
    addLog(`Failed to save config: ${error.message}`, "error");
  }
}

process.on("unhandledRejection", (reason, promise) => {
  addLog(`Unhandled Rejection at: ${promise}, reason: ${reason}`, "error");
});

process.on("uncaughtException", (error) => {
  addLog(`Uncaught Exception: ${error.message}\n${error.stack}`, "error");
  process.exit(1);
});

function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function addLog(message, type = "info") {
  if (type === "debug" && !isDebug) return;
  const timestamp = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  let coloredMessage;
  switch (type) {
    case "error":
      coloredMessage = chalk.red(message);
      break;
    case "success":
      coloredMessage = chalk.green(message);
      break;
    case "wait":
      coloredMessage = chalk.yellow(message);
      break;
    case "debug":
      coloredMessage = chalk.blue(message);
      break;
    default:
      coloredMessage = chalk.white(message);
  }
  transactionLogs.push(`{bright-cyan-fg}[{/bright-cyan-fg} {bold}{grey-fg}${timestamp}{/grey-fg}{/bold} {bright-cyan-fg}]{/bright-cyan-fg} {bold}${coloredMessage}{/bold}`);
  updateLogs();
}

function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function clearTransactionLogs() {
  transactionLogs = [];
  addLog("Transaction logs cleared.", "success");
  updateLogs();
}

function getApiHeaders(customHeaders = {}) {
  return {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Origin": "https://testnet.pharosnetwork.xyz",
    "Referer": "https://testnet.pharosnetwork.xyz/",
    ...customHeaders
  };
}

async function sleep(ms) {
  if (shouldStop) {
    if (!hasLoggedSleepInterrupt) {
      addLog("Process stopped successfully.", "info");
      hasLoggedSleepInterrupt = true;
    }
    return;
  }
  activeProcesses++;
  try {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, ms);
      const checkStop = setInterval(() => {
        if (shouldStop) {
          clearTimeout(timeout);
          clearInterval(checkStop);
          if (!hasLoggedSleepInterrupt) {
            addLog("Process stopped successfully.", "info");
            hasLoggedSleepInterrupt = true;
          }
          resolve();
        }
      }, 100);
    });
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

function loadPrivateKeys() {
  try {
    const data = fs.readFileSync("pk.txt", "utf8");
    privateKeys = data.split("\n").map(key => key.trim()).filter(key => key.match(/^(0x)?[0-9a-fA-F]{64}$/));
    if (privateKeys.length === 0) throw new Error("No valid private keys in pk.txt");
    addLog(`Loaded ${privateKeys.length} private keys from pk.txt`, "success");
  } catch (error) {
    addLog(`Failed to load private keys: ${error.message}`, "error");
    privateKeys = [];
  }
}

function loadProxies() {
  try {
    const data = fs.readFileSync("proxy.txt", "utf8");
    proxies = data.split("\n").map(proxy => proxy.trim()).filter(proxy => proxy);
    if (proxies.length === 0) throw new Error("No proxies found in proxy.txt");
    addLog(`Loaded ${proxies.length} proxies from proxy.txt`, "success");
  } catch (error) {
    addLog(`No proxy.txt found or failed to load, running without proxies: ${error.message}`, "warn");
    proxies = [];
  }
}

function loadWalletAddresses() {
  try {
    const data = fs.readFileSync("wallet.txt", "utf8");
    const addresses = data.split("\n").map(addr => addr.trim()).filter(addr => addr.match(/^0x[0-9a-fA-F]{40}$/));
    if (addresses.length === 0) throw new Error("No valid addresses in wallet.txt");
    addLog(`Loaded ${addresses.length} wallet addresses from wallet.txt`, "success");
    return addresses;
  } catch (error) {
    addLog(`No wallet.txt found or failed to load, skipping PHRS transfers: ${error.message}`, "warn");
    return [];
  }
}

function createAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith("socks")) {
    return new SocksProxyAgent(proxyUrl);
  } else {
    return new HttpsProxyAgent(proxyUrl);
  }
}

function getProviderWithProxy(proxyUrl, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const agent = createAgent(proxyUrl);
      const fetchOptions = agent ? { agent } : {};
      const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" }, { fetchOptions });
      return provider;
    } catch (error) {
      addLog(`Attempt ${attempt}/${maxRetries} failed to initialize provider: ${error.message}`, "error");
      if (attempt < maxRetries) sleep(2000);
    }
  }
  try {
    addLog(`Proxy failed, falling back to direct connection`, "warn");
    const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" });
    return provider;
  } catch (error) {
    addLog(`Fallback failed: ${error.message}`, "error");
    throw new Error("Failed to initialize provider after retries");
  }
}

function getProviderWithoutProxy() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 688688, name: "Pharos Testnet" });
    return provider;
  } catch (error) {
    addLog(`Failed to initialize provider: ${error.message}`, "error");
    throw new Error("Failed to initialize provider");
  }
}

async function makeApiRequest(method, url, data, proxyUrl, customHeaders = {}, maxRetries = 3, retryDelay = 2000, useProxy = true) {
  activeProcesses++;
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= maxRetries && !shouldStop; attempt++) {
      try {
        const agent = useProxy && proxyUrl ? createAgent(proxyUrl) : null;
        const headers = getApiHeaders(customHeaders);
        const config = {
          method,
          url,
          data,
          headers,
          ...(agent ? { httpsAgent: agent, httpAgent: agent } : {}),
          timeout: 10000
        };
        const response = await axios(config);
        return response.data;
      } catch (error) {
        lastError = error;
        let errorMessage = `Attempt ${attempt}/${maxRetries} failed for API request to ${url}`;
        if (error.response) errorMessage += `: HTTP ${error.response.status} - ${JSON.stringify(error.response.data || error.response.statusText)}`;
        else if (error.request) errorMessage += `: No response received`;
        else errorMessage += `: ${error.message}`;
        addLog(errorMessage, "error");
        if (attempt < maxRetries) {
          addLog(`Retrying API request in ${retryDelay/1000} seconds...`, "wait");
          await sleep(retryDelay);
        }
      }
    }
    throw new Error(`Failed to make API request to ${url} after ${maxRetries} attempts: ${lastError.message}`);
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

async function updateWalletData() {
  const walletDataPromises = privateKeys.map(async (privateKey, i) => {
    try {
      const proxyUrl = proxies[i % proxies.length] || null;
      const provider = getProviderWithProxy(proxyUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const [phrsBalance, balanceWPHRS, balanceUSDT] = await Promise.all([
        provider.getBalance(wallet.address).catch(() => 0),
        new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address).catch(() => 0),
        new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address).catch(() => 0)
      ]);
      const formattedPHRS = Number(ethers.formatEther(phrsBalance)).toFixed(4);
      const formattedWPHRS = Number(ethers.formatEther(balanceWPHRS)).toFixed(2);
      const formattedUSDT = Number(ethers.formatUnits(balanceUSDT, 6)).toFixed(2);
      const formattedEntry = `${i === selectedWalletIndex ? "→ " : "  "}${getShortAddress(wallet.address)}   ${formattedPHRS.padEnd(8)} ${formattedWPHRS.padEnd(8)}${formattedUSDT.padEnd(8)}`;
      if (i === selectedWalletIndex) {
        walletInfo.address = wallet.address;
        walletInfo.activeAccount = `Account ${i + 1}`;
        walletInfo.balancePHRS = formattedPHRS;
        walletInfo.balanceWPHRS = formattedWPHRS;
        walletInfo.balanceUSDT = formattedUSDT;
      }
      return formattedEntry;
    } catch (error) {
      addLog(`Failed to fetch wallet data for account #${i + 1}: ${error.message}`, "error");
      return `${i === selectedWalletIndex ? "→ " : "  "}N/A 0.00       0.00     0.00`;
    }
  });
  const walletData = await Promise.all(walletDataPromises);
  addLog("Wallet data updated.", "info");
  return walletData;
}

async function getNextNonce(provider, walletAddress) {
  if (shouldStop) {
    addLog("Nonce fetch stopped due to stop request.", "info");
    throw new Error("Process stopped");
  }
  try {
    const pendingNonce = await provider.getTransactionCount(walletAddress, "pending");
    const lastUsedNonce = nonceTracker[walletAddress] || pendingNonce - 1;
    const nextNonce = Math.max(pendingNonce, lastUsedNonce + 1);
    nonceTracker[walletAddress] = nextNonce;
    return nextNonce;
  } catch (error) {
    addLog(`Error fetching nonce for ${getShortAddress(walletAddress)}: ${error.message}`, "error");
    throw error;
  }
}

async function checkAndApproveToken(wallet, provider, tokenAddress, amount, tokenName, accountIndex, count, type = "swap") {
  if (shouldStop) {
    addLog(`${type} approval stopped due to stop request.`, "info");
    return false;
  }
  try {
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const balance = await token.balanceOf(signer.address);
    if (balance < amount) {
      addLog(`Account ${accountIndex + 1} - ${type} ${count}: Insufficient ${tokenName} balance (${ethers.formatEther(balance)})`, "error");
      return false;
    }
    const targetAddress = type === "swap" ? ROUTER_ADDRESS : type === "LP" ? LP_ADDRESS : TIP_ADDRESS;
    const allowance = await token.allowance(signer.address, targetAddress);
    if (allowance < amount) {
      addLog(`Account ${accountIndex + 1} - ${type} ${count}: Approving ${tokenName}...`, "info");
      const nonce = await getNextNonce(provider, signer.address);
      const feeData = await provider.getFeeData();
      const tx = await token.approve(targetAddress, ethers.MaxUint256, {
        gasLimit: 300000,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
        nonce
      });
      addLog(`Account ${accountIndex + 1} - ${type} ${count}: Approval sent. Hash: ${getShortHash(tx.hash)}`, "success");
      await tx.wait();
    }
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - ${type} ${count}: Error approving ${tokenName}: ${error.message}`, "error");
    return false;
  }
}

async function getDodoRoute(fromToken, toToken, fromAmount, userAddr, proxyUrl) {
  const chainId = 688688;
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const apikey = "a37546505892e1a952";
  const slippage = 10.401;
  const source = "dodoV2AndMixWasm";
  const estimateGas = true;

  const url = `https://api.dodoex.io/route-service/v2/widget/getdodoroute?chainId=${chainId}&deadLine=${deadline}&apikey=${apikey}&slippage=${slippage}&source=${source}&toTokenAddress=${toToken}&fromTokenAddress=${fromToken}&userAddr=${userAddr}&estimateGas=${estimateGas}&fromAmount=${fromAmount}`;

  try {
    const response = await makeApiRequest("get", url, null, proxyUrl, {}, 3, 2000, true);
    if (response && response.status === 200 && response.data) {
      return response.data;
    } else {
      addLog(`Failed to get Dodo route: ${response ? response.message || JSON.stringify(response) : 'No response'}`, "error");
      return null;
    }
  } catch (error) {
    addLog(`Error getting Dodo route: ${error.message}`, "error");
    return null;
  }
}

async function executeSwap(wallet, provider, swapCount, fromToken, toToken, amount, direction, accountIndex, proxyUrl) {
  if (shouldStop) {
    addLog("Swap stopped due to stop request.", "info");
    return false;
  }
  const fromTokenName = getTokenName(fromToken);
  const toTokenName = getTokenName(toToken);
  addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Preparing to swap ${amount} ${fromTokenName} to ${toTokenName}`, "info");
  
  try {
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const userAddr = signer.address;
    const decimals = fromToken === PHRS_ADDRESS ? 18 : 6;
    const fromAmount = ethers.parseUnits(amount.toString(), decimals);

    const routeData = await getDodoRoute(fromToken, toToken, fromAmount, userAddr, proxyUrl);
    if (!routeData) {
      addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Failed to get route data`, "error");
      return false;
    }

    const to = routeData.to;
    const data = routeData.data;
    const value = routeData.value ? ethers.parseUnits(routeData.value, "wei") : 0;

    if (fromToken !== PHRS_ADDRESS) {
      const isApproved = await checkAndApproveToken(wallet, provider, fromToken, fromAmount, fromTokenName, accountIndex, swapCount, "swap");
      if (!isApproved) return false;
    }

    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const tx = {
      to,
      data,
      value,
      gasLimit: 500000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("5", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
      nonce
    };

    const sentTx = await signer.sendTransaction(tx);
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Transaction sent. Hash: ${getShortHash(sentTx.hash)}`, "success");
    await sentTx.wait();
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Transaction Confirmed. Swap ${direction} completed`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Swap ${swapCount}: Failed: ${error.message}`, "error");
    return false;
  }
}

async function performLiquidityAddition(wallet, provider, lpCount, accountIndex, proxyUrl) {
  if (shouldStop) {
    addLog("Liquidity addition stopped due to stop request.", "info");
    return false;
  }
  try {
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const lpRouter = new ethers.Contract(LP_ADDRESS, LP_ABI, signer);

    const baseInAmount = ethers.parseUnits("0.001999999667913912", 18); 
    const quoteInAmount = ethers.parseUnits("0.902065", 6); 
    const baseMinAmount = ethers.parseUnits("0.0019", 18);
    const quoteMinAmount = ethers.parseUnits("0.85", 6);
    const flag = 0;
    const deadLine = Math.floor(Date.now() / 1000) + 600;
    const dvmAddress = "0x034c1f84eb9d56be15fbd003e4db18a988c0d4c6";

    const isBaseApproved = await checkAndApproveToken(wallet, provider, WPHRS_ADDRESS, baseInAmount, "WPHRS", accountIndex, lpCount, "LP");
    if (!isBaseApproved) return false;
    const isQuoteApproved = await checkAndApproveToken(wallet, provider, USDT_ADDRESS, quoteInAmount, "USDT", accountIndex, lpCount, "LP");
    if (!isQuoteApproved) return false;

    const wphrsAllowance = await new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, signer).allowance(signer.address, LP_ADDRESS);
    const usdtAllowance = await new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer).allowance(signer.address, LP_ADDRESS);
    if (wphrsAllowance < baseInAmount || usdtAllowance < quoteInAmount) {
      addLog(`Account ${accountIndex + 1} - LP ${lpCount}: Insufficient allowance`, "error");
      return false;
    }

    const txData = lpRouter.interface.encodeFunctionData("addDVMLiquidity", [
      dvmAddress,
      baseInAmount,
      quoteInAmount,
      baseMinAmount,
      quoteMinAmount,
      flag,
      deadLine
    ]);
    try {
      await provider.call({
        to: LP_ADDRESS,
        data: txData,
        from: signer.address
      });
    } catch (error) {
      addLog(`Account ${accountIndex + 1} - LP ${lpCount}: Simulation failed: ${error.message}`, "error");
      return false;
    }

    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const tx = await lpRouter.addDVMLiquidity(
      dvmAddress,
      baseInAmount,
      quoteInAmount,
      baseMinAmount,
      quoteMinAmount,
      flag,
      deadLine,
      {
        gasLimit: 600000,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei"),
        nonce
      }
    );

    addLog(`Account ${accountIndex + 1} - LP ${lpCount}: Adding liquidity WPHRS/USDT... Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Account ${accountIndex + 1} - LP ${lpCount}: Liquidity added successfully`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - LP ${lpCount}: Failed to add liquidity: ${error.message}`, "error");
    return false;
  }
}

async function executeDeposit(wallet, amountPHRs, accountIndex) {
  if (shouldStop) {
    addLog("Deposit stopped due to stop request.", "info");
    return false;
  }
  activeProcesses++;
  try {
    const provider = getProviderWithoutProxy();
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const balance = await provider.getBalance(signer.address);
    const amountWei = ethers.parseEther(amountPHRs.toString());
    if (balance < amountWei) {
      addLog(`Account ${accountIndex + 1}: Insufficient PHRs balance (${ethers.formatEther(balance)} PHRs)`, "error");
      return false;
    }
    addLog(`Account ${accountIndex + 1}: Executing deposit of ${amountPHRs} PHRs to wPHRs...`, "info");
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const tx = await signer.sendTransaction({
      to: WPHRS_ADDRESS,
      value: amountWei,
      data: "0xd0e30db0",
      gasLimit: 100000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
      nonce
    });
    addLog(`Account ${accountIndex + 1}: Deposit transaction sent. Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Account ${accountIndex + 1}: Deposit of ${amountPHRs} PHRs to wPHRs completed`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1}: Deposit failed: ${error.message}`, "error");
    return false;
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

function generateRandomUsername() {
  const adjectives = ["cool", "smart", "fast", "bright", "sharp"];
  const nouns = ["coder", "dev", "hacker", "ninja", "wizard"];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNumber = Math.floor(Math.random() * 1000);
  return `${randomAdjective}${randomNoun}${randomNumber}`;
}

async function sendTipPrimus(wallet, provider, amount, username, accountIndex, tipCount) {
  if (shouldStop) {
    addLog("Send tip stopped due to stop request.", "info");
    return false;
  }
  try {
    addLog(`Debug: ethers version = ${ethers.version}, parseUnits exists = ${!!ethers.parseUnits}, constants exists = ${!!ethers.constants}, AddressZero exists = ${!!ethers.constants?.AddressZero}, amount = ${amount}, username = ${username}`, "debug");
    
    if (!ethers.parseUnits) {
      throw new Error("ethers.parseUnits is undefined. Check Ethers.js import or version.");
    }
    
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const tipContract = new ethers.Contract(TIP_ADDRESS, TIP_ABI, signer);
    const tipAmount = ethers.parseUnits(amount.toString(), 18);
    const token = [1, "0x0000000000000000000000000000000000000000"];
    const recipient = ["x", username, tipAmount, []];

    const balance = await provider.getBalance(signer.address);
    if (balance < tipAmount) {
      addLog(`Account ${accountIndex + 1} - Tip ${tipCount}: Insufficient PHRS balance (${ethers.formatEther(balance)})`, "error");
      return false;
    }

    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const tx = await tipContract.tip(token, recipient, {
      gasLimit: Math.floor(Math.random() * (325000 - 275000 + 1)) + 275000,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
      nonce,
      value: tipAmount
    });

    addLog(`Account ${accountIndex + 1} - Tip ${tipCount}: Sent ${amount} PHRS to @${username}. Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Account ${accountIndex + 1} - Tip ${tipCount}: Transaction confirmed.`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Tip ${tipCount}: Failed to send tip: ${error.message}`, "error");
    return false;
  }
}

async function runAutoSendTip(wallet, provider, accountIndex, proxyUrl) {
  const tipRepetitions = dailyActivityConfig.tipRepetitions || 1;
  const minAmount = dailyActivityConfig.minTipAmount || 0.001;
  const maxAmount = dailyActivityConfig.maxTipAmount || 0.003;

  for (let i = 1; i <= tipRepetitions && !shouldStop; i++) {
    const amount = (Math.random() * (maxAmount - minAmount) + minAmount).toFixed(4);
    const username = generateRandomUsername();
    const success = await sendTipPrimus(wallet, provider, amount, username, accountIndex, i);
    if (success) {
      addLog(`Account ${accountIndex + 1}: Auto send tip ${i} completed.`, "success");
    } else {
      addLog(`Account ${accountIndex + 1}: Auto send tip ${i} failed.`, "error");
    }
    if (i < tipRepetitions && !shouldStop) {
      const randomDelay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
      addLog(`Account ${accountIndex + 1}: Waiting ${Math.floor(randomDelay / 1000)} seconds before next tip...`, "wait");
      await sleep(randomDelay);
    }
  }
}

async function loginAccount(wallet, proxyUrl, useProxy = true) {
  if (shouldStop) {
    addLog("Login stopped due to stop request.", "info");
    return false;
  }
  try {
    const pharosMessage = "pharos";
    const pharosSignature = await wallet.signMessage(pharosMessage);
    const pharosLoginUrl = `${API_BASE_URL}/user/login?address=${wallet.address}&signature=${pharosSignature}`;
    const pharosLoginResponse = await makeApiRequest("post", pharosLoginUrl, {}, proxyUrl, {}, 3, 2000, useProxy);
    
    if (pharosLoginResponse.code === 0) {
      accountJwts[wallet.address] = {
        pharosJwt: pharosLoginResponse.data.jwt,
        aquafluxJwt: null
      };
    } else {
      addLog(`Account ${getShortAddress(wallet.address)}: Pharos login failed: ${pharosLoginResponse.msg}`, "error");
      return false;
    }

    const timestamp = Date.now();
    const aquafluxMessage = `Sign in to AquaFlux with timestamp: ${timestamp}`;
    const aquafluxSignature = await wallet.signMessage(aquafluxMessage);
    const aquafluxPayload = {
      address: wallet.address,
      message: aquafluxMessage,
      signature: aquafluxSignature
    };
    const aquafluxLoginResponse = await makeApiRequest(
      "post",
      AQUAFLUX_BASE_URL,
      aquafluxPayload,
      proxyUrl,
      { "Content-Type": "application/json" },
      3,
      2000,
      useProxy
    );

    if (aquafluxLoginResponse.status === "success") {
      accountJwts[wallet.address].aquafluxJwt = aquafluxLoginResponse.data.accessToken;
      return true;
    } else {
      addLog(`Account ${getShortAddress(wallet.address)}: Aquaflux login failed: ${aquafluxLoginResponse.message}`, "error");
      return false;
    }
  } catch (error) {
    addLog(`Account ${getShortAddress(wallet.address)}: Login error: ${error.message}`, "error");
    return false;
  }
}

async function reportTransaction(walletAddress, txHash) {
  if (shouldStop) {
    addLog("Reporting transaction stopped due to stop request.", "info");
    return;
  }

  activeProcesses++;

  try {
    const url = "https://api.pharosnetwork.xyz/task/verify";
    const payload = {
      address: walletAddress,
      task_id: 103,
      tx_hash: txHash
    };
    const maxRetries = 5;
    let lastError = null;

    addLog(`Reporting Transaction for ${getShortAddress(walletAddress)}`, "info");

    for (let attempt = 1; attempt <= maxRetries && !shouldStop; attempt++) {
      try {
        const headers = {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "Authorization": `Bearer ${accountJwts[walletAddress]?.pharosJwt}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
          "Referer": "https://testnet.pharosnetwork.xyz/",
          "Origin": "https://testnet.pharosnetwork.xyz"
        };

        addLog(`Attempt ${attempt}/${maxRetries}: Sending report`, "info");

        const response = await makeApiRequest(
          "post",
          url,
          payload,
          null,
          headers,
          1,
          2000,
          false
        );

        if (response.code === 0 && response.data?.verified) {
          addLog(`Transaction reported successfully`, "success");
          return;
        } else {
          lastError = response.msg || 'Unknown error';
          addLog(`Attempt ${attempt}/${maxRetries} failed: ${lastError}`, "error");
        }
      } catch (error) {
        lastError = error.response?.data || error.message;
        addLog(`Attempt ${attempt}/${maxRetries} error: ${lastError}`, "error");
      }

      if (attempt < maxRetries && !shouldStop) {
        addLog(`Waiting 10 seconds before retrying...`, "wait");
        await sleep(10000);
      }
    }

    if (!shouldStop) {
      addLog(`Failed to report transaction after ${maxRetries} attempts: ${lastError}`, "error");
    }

  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

async function checkTokenHolding(walletAddress, proxyUrl) {
  const url = "https://api.aquaflux.pro/api/v1/users/check-token-holding";
  const headers = {
    "Authorization": `Bearer ${accountJwts[walletAddress]?.aquafluxJwt}`,
    "Content-Type": "application/json"
  };
  try {
    const response = await makeApiRequest("post", url, {}, proxyUrl, headers, 3, 2000, true);
    if (response && response.status === "success" && response.data?.isHoldingToken) {
      addLog(`Account ${getShortAddress(walletAddress)}: Token holding check passed.`, "success");
      return true;
    } else {
      addLog(`Account ${getShortAddress(walletAddress)}: Token holding check failed: ${response ? response.message : 'No response'}`, "error");
      return false;
    }
  } catch (error) {
    addLog(`Account ${getShortAddress(walletAddress)}: Error checking token holding: ${error.message}`, "error");
    return false;
  }
}

async function getSignature(walletAddress, nftType, proxyUrl) {
  const url = "https://api.aquaflux.pro/api/v1/users/get-signature";
  const payload = {
    walletAddress: walletAddress,
    requestedNftType: nftType 
  };
  const headers = {
    "Authorization": `Bearer ${accountJwts[walletAddress]?.aquafluxJwt}`,
    "Content-Type": "application/json"
  };
  try {
    const response = await makeApiRequest("post", url, payload, proxyUrl, headers, 3, 2000, true);
    if (response && response.status === "success" && response.data) {
      return response.data;
    } else {
      addLog(`Failed to get signature: ${response ? response.message : 'No response'}`, "error");
      return null;
    }
  } catch (error) {
    addLog(`Error getting signature: ${error.message}`, "error");
    return null;
  }
}

async function mintAquafluxNFT(wallet, provider, accountIndex, mintCount) {
  const contract = new ethers.Contract(AQUAFLUX_NFT_ADDRESS, AQUAFLUX_NFT_ABI, wallet);  
    try {
    const claimTx = await contract.claimTokens({
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("0.5", "gwei"),
      nonce: await getNextNonce(provider, wallet.address)
    });
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Claim tokens sent. Hash: ${getShortHash(claimTx.hash)}`, "success");
    await claimTx.wait();
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Claim tokens failed: ${error.message}`, "error");
    return false;
  }

  const amountToCombine = ethers.parseUnits("100", 18);
  try {
    const combineTx = await contract.combinePC(amountToCombine, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("0.5", "gwei"),
      nonce: await getNextNonce(provider, wallet.address)
    });
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Combine tokens (P+C) sent. Hash: ${getShortHash(combineTx.hash)}`, "success");
    await combineTx.wait();
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Combine tokens (P+C) failed: ${error.message}`, "error");
    return false;
  }

  const proxyUrl = proxies[accountIndex % proxies.length] || null;
  const isHoldingToken = await checkTokenHolding(wallet.address, proxyUrl);
  if (!isHoldingToken) {
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Failed token holding check, skipping mint`, "error");
    return false;
  }

  const signatureData = await getSignature(wallet.address, 0, proxyUrl);
  if (!signatureData) {
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Failed to get signature`, "error");
    return false;
  }
  const expiresAt = signatureData.expiresAt;
  const signature = signatureData.signature;

  try {
    const mintTx = await contract.mint(0, expiresAt, signature, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("1", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("0.5", "gwei"),
      nonce: await getNextNonce(provider, wallet.address)
    });
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Mint NFT sent. Hash: ${getShortHash(mintTx.hash)}`, "success");
    await mintTx.wait();
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Mint NFT successful`, "success");
    return true;
  } catch (error) {
    addLog(`Account ${accountIndex + 1} - Mint ${mintCount}: Mint NFT failed: ${error.message}`, "error");
    return false;
  }
}


async function claimFaucetPHRs() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog("Starting Auto Claim PHRS for all accounts.", "info");
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      const wallet = new ethers.Wallet(privateKeys[accountIndex]);
      addLog(`Processing claim for account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");

      if (!accountJwts[wallet.address]) {
        const loginSuccess = await loginAccount(wallet, proxyUrl);
        if (!loginSuccess) {
          addLog(`Account ${accountIndex + 1}: Skipping claim due to login failure.`, "error");
          continue;
        }
      }

      try {
        const statusUrl = `${API_BASE_URL}/faucet/status?address=${wallet.address}`;
        const statusResponse = await makeApiRequest(
          "get",
          statusUrl,
          null,
          proxyUrl,
          { "Authorization": `Bearer ${accountJwts[wallet.address].pharosJwt}` },
          3,
          2000,
          true
        );
        if (statusResponse.code === 0) {
          if (statusResponse.data.is_able_to_faucet) {
            const claimUrl = `${API_BASE_URL}/faucet/daily?address=${wallet.address}`;
            const claimResponse = await makeApiRequest(
              "post",
              claimUrl,
              {},
              proxyUrl,
              { "Authorization": `Bearer ${accountJwts[wallet.address].pharosJwt}` },
              3,
              2000,
              true
            );
            if (claimResponse.code === 0) {
              addLog(`Account ${accountIndex + 1}: PHRS faucet claimed successfully.`, "success");
            } else {
              addLog(`Account ${accountIndex + 1}: Failed to claim PHRS: ${claimResponse.msg}`, "error");
            }
          } else {
            const availableTime = statusResponse.data.avaliable_timestamp
              ? Math.round((statusResponse.data.avaliable_timestamp * 1000 - Date.now()) / (1000 * 60 * 60)) + " hours"
              : "unknown";
            addLog(`Account ${accountIndex + 1}: Already Claimed Today. Next claim available in ${availableTime}.`, "warn");
          }
        } else {
          addLog(`Account ${accountIndex + 1}: Failed to check faucet status: ${statusResponse.msg}`, "error");
        }
      } catch (error) {
        addLog(`Account ${accountIndex + 1}: Faucet status check error: ${error.message}`, "error");
      }

      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 5 seconds before next account...`, "wait");
        await sleep(5000);
      }
    }
    addLog("Auto Claim Faucet PHRS completed for all accounts.", "success");
  } catch (error) {
    addLog(`Auto Claim PHRs failed: ${error.message}`, "error");
  } finally {
    await updateWallets();
  }
}

async function claimFaucetUSDT() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog("Starting Auto Claim USDT for all accounts.", "info");
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      const wallet = new ethers.Wallet(privateKeys[accountIndex]);
      addLog(`Processing USDT claim for account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");

      try {
        const payload = {
          tokenAddress: USDT_ADDRESS,
          userAddress: wallet.address
        };
        const claimResponse = await makeApiRequest(
          "post",
          FAUCET_USDT_URL,
          payload,
          proxyUrl,
          { "Content-Type": "application/json" },
          3,
          2000,
          true
        );
        if (claimResponse.status === 200) {
          addLog(`Account ${accountIndex + 1}: USDT faucet claimed successfully. TxHash: ${getShortHash(claimResponse.data.txHash)}`, "success");
        } else if (claimResponse.status === 400 && claimResponse.message.includes("has already got token today")) {
          addLog(`Account ${accountIndex + 1}: Cannot claim USDT. Already claimed today.`, "warn");
        } else {
          addLog(`Account ${accountIndex + 1}: Failed to claim USDT: ${claimResponse.message}`, "error");
        }
      } catch (error) {
        addLog(`Account ${accountIndex + 1}: USDT faucet claim error: ${error.message}`, "error");
      }

      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 5 seconds before next account...`, "wait");
        await sleep(5000);
      }
    }
    addLog("Auto Claim USDT completed for all accounts.", "success");
  } catch (error) {
    addLog(`Auto Claim USDT failed: ${error.message}`, "error");
  } finally {
    await updateWallets();
  }
}

async function runDailyActivity() {
  if (privateKeys.length === 0) {
    addLog("No valid private keys found.", "error");
    return;
  }
  addLog(`Starting daily activity for all accounts. Auto Swap: ${dailyActivityConfig.swapRepetitions}, Auto Send PHRS: ${dailyActivityConfig.sendPhrsRepetitions}, Auto Add LP: ${dailyActivityConfig.addLiquidityRepetitions}, Auto Tip: ${dailyActivityConfig.tipRepetitions}, Auto Mint: ${dailyActivityConfig.mintRepetitions}`, "info");
  activityRunning = true;
  isCycleRunning = true;
  shouldStop = false;
  hasLoggedSleepInterrupt = false;
  activeProcesses = Math.max(0, activeProcesses);
  updateMenu();
  try {
    for (let accountIndex = 0; accountIndex < privateKeys.length && !shouldStop; accountIndex++) {
      addLog(`Starting processing for account ${accountIndex + 1}`, "info");
      selectedWalletIndex = accountIndex;
      const proxyUrl = proxies[accountIndex % proxies.length] || null;
      let provider;
      addLog(`Account ${accountIndex + 1}: Using Proxy ${proxyUrl || "none"}...`, "info");
      try {
        provider = getProviderWithProxy(proxyUrl);
        await provider.getNetwork();
        addLog(`Provider connection verified for account ${accountIndex + 1}`, "info");
      } catch (error) {
        addLog(`Failed to connect to provider for account ${accountIndex + 1}: ${error.message}`, "error");
        continue;
      }
      const wallet = new ethers.Wallet(privateKeys[accountIndex], provider);
      addLog(`Processing account ${accountIndex + 1}: ${getShortAddress(wallet.address)}`, "info");
      const loginSuccess = await loginAccount(wallet, proxyUrl);
      if (!loginSuccess) {
        addLog(`Account ${accountIndex + 1}: Skipping daily activity due to login failure.`, "error");
        continue;
      }

      if (!shouldStop) {
        let successfulSwaps = 0;
        for (let attempt = 1; attempt <= dailyActivityConfig.swapRepetitions && !shouldStop; attempt++) {
          const isPHRSToUSDT = attempt % 2 === 1;
          const fromToken = isPHRSToUSDT ? PHRS_ADDRESS : USDT_ADDRESS;
          const toToken = isPHRSToUSDT ? USDT_ADDRESS : PHRS_ADDRESS;
          let amount;
          if (fromToken === PHRS_ADDRESS) {
            amount = (Math.random() * (0.004 - 0.001) + 0.001).toFixed(4);
          } else {
            amount = (Math.random() * (10 - 5) + 5).toFixed(4);
          }
          const direction = isPHRSToUSDT ? "PHRS ➯ USDT" : "USDT ➯ PHRS";
          const swapSuccess = await executeSwap(wallet, provider, attempt, fromToken, toToken, amount, direction, accountIndex, proxyUrl);
          if (swapSuccess) {
            successfulSwaps++;
            await updateWallets();
            if (successfulSwaps < dailyActivityConfig.swapRepetitions && !shouldStop) {
              const randomDelay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
              addLog(`Account ${accountIndex + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next swap...`, "wait");
              await sleep(randomDelay);
            }
          } else {
            addLog(`Account ${accountIndex + 1} - Swap attempt ${attempt}: Failed, skipping to next swap`, "error");
          }
        }
        if (successfulSwaps >= dailyActivityConfig.swapRepetitions) {
          addLog(`Account ${accountIndex + 1}: Completed ${successfulSwaps} successful swaps.`, "success");
        }
      }

      if (!shouldStop) {
        let successfulLPs = 0;
        for (let attempt = 1; attempt <= dailyActivityConfig.addLiquidityRepetitions && !shouldStop; attempt++) {
          const lpSuccess = await performLiquidityAddition(wallet, provider, attempt, accountIndex, proxyUrl);
          if (lpSuccess) {
            successfulLPs++;
            await updateWallets();
            if (successfulLPs < dailyActivityConfig.addLiquidityRepetitions && !shouldStop) {
              const randomDelay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
              addLog(`Account ${accountIndex + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next LP...`, "wait");
              await sleep(randomDelay);
            }
          } else {
            addLog(`Account ${accountIndex + 1} - LP attempt ${attempt}: Failed, skipping to next LP`, "error");
          }
        }
        if (successfulLPs >= dailyActivityConfig.addLiquidityRepetitions) {
          addLog(`Account ${accountIndex + 1}: Completed ${successfulLPs} successful Add LP.`, "success");
        }
      }

      if (!shouldStop) {
        let successfulMints = 0;
        for (let attempt = 1; attempt <= dailyActivityConfig.mintRepetitions && !shouldStop; attempt++) {
          const mintSuccess = await mintAquafluxNFT(wallet, provider, accountIndex, attempt);
          if (mintSuccess) {
            successfulMints++;
            if (successfulMints < dailyActivityConfig.mintRepetitions && !shouldStop) {
              const randomDelay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
              addLog(`Account ${accountIndex + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next mint...`, "wait");
              await sleep(randomDelay);
            }
          } else {
            addLog(`Account ${accountIndex + 1} - Mint attempt ${attempt}: Failed, skipping to next mint`, "error");
          }
        }
        if (successfulMints >= dailyActivityConfig.mintRepetitions) {
          addLog(`Account ${accountIndex + 1}: Completed ${successfulMints} successful NFT mints.`, "success");
        }
      }

      if (!shouldStop) {
        await runAutoSendTip(wallet, provider, accountIndex, proxyUrl);
      }

      if (!shouldStop) {
        const addresses = loadWalletAddresses();
        let successfulTransfers = 0;
        if (addresses.length > 0) {
          for (let i = 0; i < dailyActivityConfig.sendPhrsRepetitions && !shouldStop; i++) {
            let recipient;
            do {
              recipient = addresses[Math.floor(Math.random() * addresses.length)];
            } while (recipient.toLowerCase() === wallet.address.toLowerCase());
            const amount = ethers.parseEther((Math.random() * (0.0002 - 0.0001) + 0.0001).toFixed(6));
            try {
              const balance = await provider.getBalance(wallet.address);
              if (balance < amount) {
                addLog(`Account ${accountIndex + 1}: Insufficient PHRS balance for transfer (${ethers.formatEther(balance)} PHRS)`, "error");
                continue;
              }
              addLog(`Account ${accountIndex + 1}: Sending ${ethers.formatEther(amount)} PHRS to ${getShortAddress(recipient)}...`, "info");
              const feeData = await provider.getFeeData();
              const tx = await wallet.sendTransaction({
                to: recipient,
                value: amount,
                gasLimit: 21000,
                maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1", "gwei"),
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("0.5", "gwei"),
                nonce: await getNextNonce(provider, wallet.address)
              });
              addLog(`Account ${accountIndex + 1}: Sent ${ethers.formatEther(amount)} PHRS to ${getShortAddress(recipient)}. Hash: ${getShortHash(tx.hash)}`, "success");
              await tx.wait();
              successfulTransfers++;
              await reportTransaction(wallet.address, tx.hash);
            } catch (error) {
              addLog(`Account ${accountIndex + 1}: Failed to send PHRS to ${getShortAddress(recipient)}: ${error.message}`, "error");
            }
            if (i < dailyActivityConfig.sendPhrsRepetitions - 1 && !shouldStop) await sleep(5000);
          }
          addLog(`Account ${accountIndex + 1}: Completed ${successfulTransfers} successful PHRS transfers.`, "success");
        }
      }

      if (!shouldStop && accountJwts[wallet.address]) {
        try {
          const checkinUrl = `${API_BASE_URL}/sign/in?address=${wallet.address}`;
          const checkinResponse = await makeApiRequest(
            "post",
            checkinUrl,
            {},
            proxyUrl,
            { "Authorization": `Bearer ${accountJwts[wallet.address].pharosJwt}` },
            3,
            2000,
            true
          );
          if (checkinResponse.code === 0) {
            addLog(`Account ${accountIndex + 1}: Daily check-in successful.`, "success");
          } else {
            addLog(`Account ${accountIndex + 1}: Check-in failed: ${checkinResponse.msg}`, "error");
          }
        } catch (error) {
          addLog(`Account ${accountIndex + 1}: Check-in error: ${error.message}`, "error");
        }
      }

      if (!shouldStop && accountJwts[wallet.address]) {
        try {
          const profileUrl = `${API_BASE_URL}/user/profile?address=${wallet.address}`;
          const profileResponse = await makeApiRequest(
            "get",
            profileUrl,
            null,
            proxyUrl,
            { "Authorization": `Bearer ${accountJwts[wallet.address].pharosJwt}` },
            3,
            2000,
            true
          );
          if (profileResponse.code === 0) {
            const userInfo = profileResponse.data.user_info;
            addLog(`Account ${accountIndex + 1}: Address: ${userInfo.Address}, Total Points: ${userInfo.TotalPoints}`, "info");
          } else {
            addLog(`Account ${accountIndex + 1}: Failed to get profile: ${profileResponse.msg}`, "error");
          }
        } catch (error) {
          addLog(`Account ${accountIndex + 1}: Profile fetch error: ${error.message}`, "error");
        }
      }

      if (accountIndex < privateKeys.length - 1 && !shouldStop) {
        addLog(`Waiting 60 seconds before next account...`, "wait");
        await sleep(60000);
      }
    }
    if (!shouldStop && activeProcesses <= 0) {
      addLog("All accounts processed. Waiting 24 hours for next cycle.", "success");
      dailyActivityInterval = setTimeout(runDailyActivity, 24 * 60 * 60 * 1000);
    }
  } catch (error) {
    addLog(`Daily activity failed: ${error.message}`, "error");
  } finally {
    if (shouldStop) {
      const stopCheckInterval = setInterval(() => {
        if (activeProcesses <= 0) {
          clearInterval(stopCheckInterval);
          activityRunning = false;
          isCycleRunning = false;
          shouldStop = false;
          hasLoggedSleepInterrupt = false;
          activeProcesses = 0;
          addLog(`Daily activity stopped successfully.`, "success");
          updateMenu();
          updateStatus();
          safeRender();
        } else {
          addLog(`Waiting for ${activeProcesses} process(es) to complete...`, "info");
        }
      }, 1000);
    } else {
      activityRunning = false;
      isCycleRunning = activeProcesses > 0 || dailyActivityInterval !== null;
      updateMenu();
      updateStatus();
      safeRender();
    }
    nonceTracker = {};
  }
}

const screen = blessed.screen({
  smartCSR: true,
  title: "FAROSWAP AUTO BOT",
  autoPadding: true,
  fullUnicode: true,
  mouse: true,
  ignoreLocked: ["C-c", "q", "escape"]
});

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  height: 6,
  tags: true,
  style: { fg: "yellow", bg: "default" }
});

const statusBox = blessed.box({
  left: 0,
  top: 6,
  width: "100%",
  height: 3,
  tags: true,
  border: { type: "line", fg: "cyan" },
  style: { fg: "white", bg: "default", border: { fg: "cyan" } },
  content: "Status: Initializing...",
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  label: chalk.cyan(" Status "),
  wrap: true
});

const walletBox = blessed.list({
  label: " Wallet Information",
  top: 9,
  left: 0,
  width: "40%",
  height: "35%",
  border: { type: "line", fg: "cyan" },
  style: { border: { fg: "cyan" }, fg: "white", bg: "default", item: { fg: "white" } },
  scrollable: true,
  scrollbar: { bg: "cyan", fg: "black" },
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  content: "Loading wallet data..."
});

const logBox = blessed.log({
  label: " Transaction Logs",
  top: 9,
  left: "41%",
  width: "60%",
  height: "100%-9",
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true, style: { bg: "cyan" } },
  content: "",
  style: { border: { fg: "magenta" }, bg: "default" },
  padding: { left: 1, right: 1, top: 0, bottom: 0 },
  wrap: true
});

const menuBox = blessed.list({
  label: " Menu ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "magenta", fg: "black" }, item: { fg: "white" } },
  items: isCycleRunning
    ? ["Stop Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
    : ["Start Auto Daily Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"],
  padding: { left: 1, top: 1 }
});

const faucetSubMenu = blessed.list({
  label: " Claim Faucet Options ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "green" },
    selected: { bg: "green", fg: "black" },
    item: { fg: "white" }
  },
  items: ["Auto Claim PHRS", "Auto Claim USDT", "Clear Logs", "Refresh", "Back to Main Menu"],
  padding: { left: 1, top: 1 },
  hidden: true
});

const swapSubMenu = blessed.list({
  label: " Swap PHRs & wPHRs Options ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "yellow" },
    selected: { bg: "yellow", fg: "black" },
    item: { fg: "white" }
  },
  items: ["Swap All Wallets", "Select Wallet", "Back to Main Menu"],
  padding: { left: 1, top: 1 },
  hidden: true
});

const dailyActivitySubMenu = blessed.list({
  label: " Manual Config Options ",
  top: "44%",
  left: 0,
  width: "40%",
  height: "56%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "blue" },
    selected: { bg: "blue", fg: "black" },
    item: { fg: "white" }
  },
  items: ["Set Swap Config", "Set Send PHRS Config", "Set LP Config", "Set Tip Config", "Set Mint Config", "Back to Main Menu"],
  padding: { left: 1, top: 1 },
  hidden: true
});

const walletListMenu = blessed.list({
  label: " Select Wallet ",
  top: "44%",
  left: "center",
  width: "50%",
  height: "50%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "cyan" },
    selected: { bg: "cyan", fg: "black" },
    item: { fg: "white" }
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const amountForm = blessed.form({
  label: " Enter PHRs Amount ",
  top: "center",
  left: "center",
  width: "30%",
  height: "30%",
  keys: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "blue" }
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const amountInput = blessed.textbox({
  parent: amountForm,
  top: 1,
  left: 1,
  width: "90%",
  height: 3,
  inputOnFocus: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const submitButton = blessed.button({
  parent: amountForm,
  top: 5,
  left: "center",
  width: 10,
  height: 3,
  content: "Submit",
  align: "center",
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "blue",
    border: { fg: "white" },
    hover: { bg: "green" },
    focus: { bg: "green" }
  }
});

const repetitionsForm = blessed.form({
  label: " Enter Manual Config ",
  top: "center",
  left: "center",
  width: "30%",
  height: "30%",
  keys: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "blue" }
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const repetitionsInput = blessed.textbox({
  parent: repetitionsForm,
  top: 1,
  left: 1,
  width: "90%",
  height: 3,
  inputOnFocus: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const repetitionsSubmitButton = blessed.button({
  parent: repetitionsForm,
  top: 5,
  left: "center",
  width: 10,
  height: 3,
  content: "Submit",
  align: "center",
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "blue",
    border: { fg: "white" },
    hover: { bg: "green" },
    focus: { bg: "green" }
  }
});

const tipConfigForm = blessed.form({
  parent: screen,
  label: " Set Tip Config ",
  top: "center",
  left: "center",
  width: "30%",
  height: "25%",
  keys: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "blue" }
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const tipRepetitionsInput = blessed.textbox({
  parent: tipConfigForm,
  name: "tipRepetitions",
  top: 1,
  left: 1,
  width: "90%",
  height: 3,
  label: "Repetitions",
  inputOnFocus: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const tipSubmitButton = blessed.button({
  parent: tipConfigForm,
  top: 5,
  left: "center",
  width: 10,
  height: 3,
  content: "Submit",
  align: "center",
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "blue",
    border: { fg: "white" },
    hover: { bg: "green" },
    focus: { bg: "green" }
  }
});

const mintConfigForm = blessed.form({
  label: " Set Mint Config ",
  top: "center",
  left: "center",
  width: "30%",
  height: "25%",
  keys: true,
  mouse: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "blue" }
  },
  padding: { left: 1, top: 1 },
  hidden: true
});

const mintRepetitionsInput = blessed.textbox({
  parent: mintConfigForm,
  name: "mintRepetitions",
  top: 1,
  left: 1,
  width: "90%",
  height: 3,
  label: "Repetitions",
  inputOnFocus: true,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "default",
    border: { fg: "white" },
    focus: { border: { fg: "green" } }
  }
});

const mintSubmitButton = blessed.button({
  parent: mintConfigForm,
  top: 5,
  left: "center",
  width: 10,
  height: 3,
  content: "Submit",
  align: "center",
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "blue",
    border: { fg: "white" },
    hover: { bg: "green" },
    focus: { bg: "green" }
  }
});

screen.append(headerBox);
screen.append(statusBox);
screen.append(walletBox);
screen.append(logBox);
screen.append(menuBox);
screen.append(faucetSubMenu);
screen.append(swapSubMenu);
screen.append(dailyActivitySubMenu);
screen.append(walletListMenu);
screen.append(amountForm);
screen.append(repetitionsForm);
screen.append(tipConfigForm);
screen.append(mintConfigForm);

let renderQueue = [];
let isRendering = false;
function safeRender() {
  renderQueue.push(true);
  if (isRendering) return;
  isRendering = true;
  setTimeout(() => {
    try {
      if (!isHeaderRendered) {
        figlet.text("NT EXHAUST", { font: "ANSI Shadow" }, (err, data) => {
          if (!err) headerBox.setContent(`{center}{bold}{cyan-fg}${data}{/cyan-fg}{/bold}{/center}`);
          isHeaderRendered = true;
        });
      }
      screen.render();
    } catch (error) {
      addLog(`UI render error: ${error.message}`, "error");
    }
    renderQueue.shift();
    isRendering = false;
    if (renderQueue.length > 0) safeRender();
  }, 100);
}

function adjustLayout() {
  const screenHeight = screen.height || 24;
  const screenWidth = screen.width || 80;

  headerBox.height = Math.max(6, Math.floor(screenHeight * 0.15));
  statusBox.top = headerBox.height;
  statusBox.height = Math.max(3, Math.floor(screenHeight * 0.07));

  walletBox.top = headerBox.height + statusBox.height;
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);

  logBox.top = headerBox.height + statusBox.height;
  logBox.left = Math.floor(screenWidth * 0.41);
  logBox.width = Math.floor(screenWidth * 0.6);
  logBox.height = screenHeight - (headerBox.height + statusBox.height);

  menuBox.top = headerBox.height + statusBox.height + walletBox.height;
  menuBox.width = Math.floor(screenWidth * 0.4);
  menuBox.height = screenHeight - (headerBox.height + statusBox.height + walletBox.height);

  if (menuBox.top != null) {
    faucetSubMenu.top = menuBox.top;
    faucetSubMenu.width = menuBox.width;
    faucetSubMenu.height = menuBox.height;
    faucetSubMenu.left = menuBox.left;
    swapSubMenu.top = menuBox.top;
    swapSubMenu.width = menuBox.width;
    swapSubMenu.height = menuBox.height;
    swapSubMenu.left = menuBox.left;
    dailyActivitySubMenu.top = menuBox.top;
    dailyActivitySubMenu.width = menuBox.width;
    dailyActivitySubMenu.height = menuBox.height;
    dailyActivitySubMenu.left = menuBox.left;
    walletListMenu.top = headerBox.height + statusBox.height + Math.floor(screenHeight * 0.1);
    walletListMenu.width = Math.floor(screenWidth * 0.5);
    walletListMenu.height = Math.floor(screenHeight * 0.5);
    amountForm.width = Math.floor(screenWidth * 0.3);
    amountForm.height = Math.floor(screenHeight * 0.3);
    repetitionsForm.width = Math.floor(screenWidth * 0.3);
    repetitionsForm.height = Math.floor(screenHeight * 0.3);
    tipConfigForm.width = Math.floor(screenWidth * 0.3);
    tipConfigForm.height = Math.floor(screenHeight * 0.25);
    mintConfigForm.width = Math.floor(screenWidth * 0.3);
    mintConfigForm.height = Math.floor(screenHeight * 0.25);
  }

  safeRender();
}

function updateStatus() {
  const isProcessing = activityRunning || isCycleRunning;
  const status = activityRunning
    ? `${loadingSpinner[spinnerIndex]} ${chalk.yellowBright("Running")}`
    : isCycleRunning
      ? `${loadingSpinner[spinnerIndex]} ${chalk.yellowBright("Waiting for next cycle")}`
      : chalk.green("Idle");
  const statusText = `Status: ${status} | Active Account: ${getShortAddress(walletInfo.address)} | Total Accounts: ${privateKeys.length} | Swap: ${dailyActivityConfig.swapRepetitions}x | Send: ${dailyActivityConfig.sendPhrsRepetitions}x | LP: ${dailyActivityConfig.addLiquidityRepetitions}x | Tip: ${dailyActivityConfig.tipRepetitions}x | Mint: ${dailyActivityConfig.mintRepetitions}x`;
  try {
    statusBox.setContent(statusText);
  } catch (error) {
    addLog(`Status update error: ${error.message}`, "error");
  }
  if (isProcessing) {
    if (blinkCounter % 1 === 0) {
      statusBox.style.border.fg = borderBlinkColors[borderBlinkIndex];
      borderBlinkIndex = (borderBlinkIndex + 1) % borderBlinkColors.length;
    }
    blinkCounter++;
  } else {
    statusBox.style.border.fg = "cyan";
  }
  spinnerIndex = (spinnerIndex + 1) % loadingSpinner.length;
  safeRender();
}

async function updateWallets() {
  const walletData = await updateWalletData();
  const header = `${chalk.bold.cyan("     Address".padEnd(12))}       ${chalk.bold.cyan("PHRs".padEnd(8))}${chalk.bold.cyan("wPHRs".padEnd(8))}${chalk.bold.cyan("USDT".padEnd(8))}`;
  const separator = chalk.gray("-".repeat(49));
  try {
    walletBox.setItems([header, separator, ...walletData]);
    walletBox.select(0);
  } catch (error) {
    addLog(`Wallet update error: ${error.message}`, "error");
  }
  safeRender();
}

function updateLogs() {
  try {
    logBox.setContent(transactionLogs.join("\n") || chalk.gray("Tidak ada log tersedia."));
    logBox.setScrollPerc(100);
  } catch (error) {
    addLog(`Log update error: ${error.message}`, "error");
  }
  safeRender();
}

function updateMenu() {
  try {
    menuBox.setItems(
      isCycleRunning
        ? ["Stop Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
        : ["Start Auto Daily Activity", "Claim Faucet", "Auto Swap PHRS & wPHRS", "Set Manual Config", "Clear Logs", "Refresh", "Exit"]
    );
  } catch (error) {
    addLog(`Menu update error: ${error.message}`, "error");
  }
  safeRender();
}

const statusInterval = setInterval(updateStatus, 100);

menuBox.on("select", async item => {
  const action = item.getText();
  switch (action) {
    case "Start Auto Daily Activity":
      if (isCycleRunning) {
        addLog("Cycle is still running. Stop the current cycle first.", "error");
      } else {
        await runDailyActivity();
      }
      break;
    case "Stop Activity":
      shouldStop = true;
      if (dailyActivityInterval) {
        clearTimeout(dailyActivityInterval);
        dailyActivityInterval = null;
      }
      addLog("Stopping daily activity... Please wait for ongoing processes to complete.", "info");
      const stopCheckInterval = setInterval(() => {
        if (activeProcesses <= 0) {
          clearInterval(stopCheckInterval);
          activityRunning = false;
          isCycleRunning = false;
          shouldStop = false;
          hasLoggedSleepInterrupt = false;
          activeProcesses = 0;
          addLog(`Daily activity stopped successfully.`, "success");
          updateMenu();
          updateStatus();
          safeRender();
        } else {
          addLog(`Waiting for ${activeProcesses} process to complete...`, "info");
        }
      }, 1000);
      break;
    case "Claim Faucet":
      menuBox.hide();
      faucetSubMenu.show();
      setTimeout(() => {
        if (faucetSubMenu.visible) {
          screen.focusPush(faucetSubMenu);
          faucetSubMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Auto Swap PHRS & wPHRS":
      menuBox.hide();
      swapSubMenu.show();
      setTimeout(() => {
        if (swapSubMenu.visible) {
          screen.focusPush(swapSubMenu);
          swapSubMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Set Manual Config":
      menuBox.hide();
      dailyActivitySubMenu.show();
      setTimeout(() => {
        if (dailyActivitySubMenu.visible) {
          screen.focusPush(dailyActivitySubMenu);
          dailyActivitySubMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Clear Logs":
      clearTransactionLogs();
      break;
    case "Refresh":
      await updateWallets();
      addLog("Data refreshed.", "success");
      break;
    case "Exit":
      clearInterval(statusInterval);
      process.exit(0);
  }
  if (action !== "Claim Faucet" && action !== "Auto Swap PHRS & wPHRS" && action !== "Set Manual Config") {
    menuBox.focus();
    safeRender();
  }
});

faucetSubMenu.on("select", async item => {
  const action = item.getText();
  switch (action) {
    case "Auto Claim PHRS":
      await claimFaucetPHRs();
      break;
    case "Auto Claim USDT":
      await claimFaucetUSDT();
      break;
    case "Clear Logs":
      clearTransactionLogs();
      break;
    case "Refresh":
      await updateWallets();
      addLog("Data refreshed.", "success");
      break;
    case "Back to Main Menu":
      faucetSubMenu.hide();
      menuBox.show();
      setTimeout(() => {
        if (menuBox.visible) {
          screen.focusPush(menuBox);
          menuBox.select(0);
          safeRender();
        }
      }, 100);
      break;
  }
});

swapSubMenu.on("select", async item => {
  const action = item.getText();
  switch (action) {
    case "Swap All Wallets":
      amountForm.show();
      amountForm.swapAll = true;
      setTimeout(() => {
        if (amountForm.visible) {
          screen.focusPush(amountInput);
          amountInput.setValue("");
          safeRender();
        }
      }, 100);
      break;
    case "Select Wallet":
      walletListMenu.setItems(privateKeys.map((key, index) => {
        const wallet = new ethers.Wallet(key);
        return `Account ${index + 1}: ${getShortAddress(wallet.address)}`;
      }));
      walletListMenu.show();
      setTimeout(() => {
        if (walletListMenu.visible) {
          screen.focusPush(walletListMenu);
          walletListMenu.select(0);
          safeRender();
        }
      }, 100);
      break;
    case "Back to Main Menu":
      swapSubMenu.hide();
      menuBox.show();
      setTimeout(() => {
        if (menuBox.visible) {
          screen.focusPush(menuBox);
          menuBox.select(0);
          safeRender();
        }
      }, 100);
      break;
  }
});

dailyActivitySubMenu.on("select", item => {
  const action = item.getText();
  switch (action) {
    case "Set Swap Config":
      repetitionsForm.show();
      repetitionsForm.configType = "swap";
      setTimeout(() => {
        if (repetitionsForm.visible) {
          screen.focusPush(repetitionsInput);
          repetitionsInput.setValue(dailyActivityConfig.swapRepetitions.toString());
          safeRender();
        }
      }, 100);
      break;
    case "Set Send PHRS Config":
      repetitionsForm.show();
      repetitionsForm.configType = "sendPhrs";
      setTimeout(() => {
        if (repetitionsForm.visible) {
          screen.focusPush(repetitionsInput);
          repetitionsInput.setValue(dailyActivityConfig.sendPhrsRepetitions.toString());
          safeRender();
        }
      }, 100);
      break;
    case "Set LP Config":
      repetitionsForm.show();
      repetitionsForm.configType = "addLiquidity";
      setTimeout(() => {
        if (repetitionsForm.visible) {
          screen.focusPush(repetitionsInput);
          repetitionsInput.setValue(dailyActivityConfig.addLiquidityRepetitions.toString());
          safeRender();
        }
      }, 100);
      break;
    case "Set Tip Config":
      tipConfigForm.show();
      setTimeout(() => {
        if (tipConfigForm.visible) {
          screen.focusPush(tipRepetitionsInput);
          tipRepetitionsInput.setValue(dailyActivityConfig.tipRepetitions.toString());
          safeRender();
        }
      }, 100);
      break;
    case "Set Mint Config":
      mintConfigForm.show();
      setTimeout(() => {
        if (mintConfigForm.visible) {
          screen.focusPush(mintRepetitionsInput);
          mintRepetitionsInput.setValue(dailyActivityConfig.mintRepetitions.toString());
          safeRender();
        }
      }, 100);
      break;
    case "Back to Main Menu":
      dailyActivitySubMenu.hide();
      menuBox.show();
      setTimeout(() => {
        if (menuBox.visible) {
          screen.focusPush(menuBox);
          menuBox.select(0);
          safeRender();
        }
      }, 100);
      break;
  }
});

walletListMenu.on("select", item => {
  const selectedIndex = walletListMenu.selected;
  addLog(`Wallet selected: Account ${selectedIndex + 1}`, "info");
  walletListMenu.hide();
  amountForm.show();
  amountForm.swapAll = false;
  amountForm.selectedWalletIndex = selectedIndex;
  setTimeout(() => {
    if (amountForm.visible) {
      screen.focusPush(amountInput);
      amountInput.setValue("");
      safeRender();
    }
  }, 100);
});

walletListMenu.key(["escape"], () => {
  walletListMenu.hide();
  swapSubMenu.show();
  setTimeout(() => {
    if (swapSubMenu.visible) {
      screen.focusPush(swapSubMenu);
      swapSubMenu.select(0);
      safeRender();
    }
  }, 100);
});

amountInput.key(["enter"], () => {
  addLog("Enter pressed in amount input", "info");
  amountForm.submit();
});

amountForm.on("submit", async () => {
  const amountText = amountInput.getValue().trim();
  let amountPHRs;
  try {
    amountPHRs = parseFloat(amountText);
    if (isNaN(amountPHRs) || amountPHRs <= 0) {
      addLog("Invalid amount. Please enter a positive number.", "error");
      amountInput.setValue("");
      screen.focusPush(amountInput);
      safeRender();
      return;
    }
  } catch (error) {
    addLog(`Invalid amount format: ${error.message}`, "error");
    amountInput.setValue("");
    screen.focusPush(amountInput);
    safeRender();
    return;
  }

  amountForm.hide();
  addLog(`Starting Auto Swap PHRS to wPHRs with amount: ${amountPHRs} PHRs.`, "info");

  try {
    if (amountForm.swapAll) {
      for (let i = 0; i < privateKeys.length && !shouldStop; i++) {
        const wallet = new ethers.Wallet(privateKeys[i]);
        addLog(`Processing swap for account ${i + 1}: ${getShortAddress(wallet.address)}`, "info");
        await executeDeposit(wallet, amountPHRs, i);
        if (i < privateKeys.length - 1 && !shouldStop) {
          addLog(`Waiting 5 seconds before next account...`, "wait");
          await sleep(5000);
        }
      }
    } else {
      const wallet = new ethers.Wallet(privateKeys[amountForm.selectedWalletIndex]);
      addLog(`Processing swap for account ${amountForm.selectedWalletIndex + 1}: ${getShortAddress(wallet.address)}`, "info");
      await executeDeposit(wallet, amountPHRs, amountForm.selectedWalletIndex);
    }
    addLog("Auto Swap PHRS ➯ wPHRs completed.", "success");
  } catch (error) {
    addLog(`Auto Swap PHRS ➯ wPHRs failed: ${error.message}`, "error");
  } finally {
    await updateWallets();
    swapSubMenu.show();
    setTimeout(() => {
      if (swapSubMenu.visible) {
        screen.focusPush(swapSubMenu);
        swapSubMenu.select(0);
        safeRender();
      }
    }, 100);
  }
});

submitButton.on("press", () => {
  addLog("Submit button pressed", "info");
  amountForm.submit();
});

amountForm.key(["escape"], () => {
  addLog("Escape pressed in amount form, returning to swap submenu", "info");
  amountForm.hide();
  swapSubMenu.show();
  setTimeout(() => {
    if (swapSubMenu.visible) {
      screen.focusPush(swapSubMenu);
      swapSubMenu.select(0);
      safeRender();
    }
  }, 100);
});

repetitionsInput.key(["enter"], () => {
  repetitionsForm.submit();
});

repetitionsForm.on("submit", () => {
  const repetitionsText = repetitionsInput.getValue().trim();
  let repetitions;
  try {
    repetitions = parseInt(repetitionsText, 10);
    if (isNaN(repetitions) || repetitions < 1 || repetitions > 1000) {
      addLog("Invalid input. Please enter a number between 1 and 1000.", "error");
      repetitionsInput.setValue("");
      screen.focusPush(repetitionsInput);
      safeRender();
      return;
    }
  } catch (error) {
    addLog(`Invalid format: ${error.message}`, "error");
    repetitionsInput.setValue("");
    screen.focusPush(repetitionsInput);
    safeRender();
    return;
  }

  if (repetitionsForm.configType === "swap") {
    dailyActivityConfig.swapRepetitions = repetitions;
    addLog(`Swap Config set to ${repetitions}`, "success");
  } else if (repetitionsForm.configType === "sendPhrs") {
    dailyActivityConfig.sendPhrsRepetitions = repetitions;
    addLog(`Send PHRS Config set to ${repetitions}`, "success");
  } else if (repetitionsForm.configType === "addLiquidity") {
    dailyActivityConfig.addLiquidityRepetitions = repetitions;
    addLog(`LP Config set to ${repetitions}`, "success");
  }
  saveConfig();
  updateStatus();

  repetitionsForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

repetitionsSubmitButton.on("press", () => {
  repetitionsForm.submit();
});

repetitionsForm.key(["escape"], () => {
  repetitionsForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

tipRepetitionsInput.key(["enter"], () => {
  tipConfigForm.submit();
});

tipSubmitButton.on("press", () => {
  tipConfigForm.submit();
});

tipConfigForm.on("submit", () => {
  const repetitionsText = tipRepetitionsInput.getValue().trim();
  let repetitions;
  try {
    repetitions = parseInt(repetitionsText, 10);
    if (isNaN(repetitions) || repetitions < 1 || repetitions > 1000) {
      addLog("Invalid input. Please enter a number between 1 and 1000.", "error");
      tipRepetitionsInput.setValue("");
      screen.focusPush(tipRepetitionsInput);
      safeRender();
      return;
    }
  } catch (error) {
    addLog(`Invalid format: ${error.message}`, "error");
    tipRepetitionsInput.setValue("");
    screen.focusPush(tipRepetitionsInput);
    safeRender();
    return;
  }

  dailyActivityConfig.tipRepetitions = repetitions;
  addLog(`Tip Config set to ${repetitions} repetitions`, "success");
  saveConfig();
  updateStatus();

  tipConfigForm.hide();
  dailyActivitySubMenu.show();
  screen.render();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

tipConfigForm.key(["escape"], () => {
  tipConfigForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

mintRepetitionsInput.key(["enter"], () => {
  mintConfigForm.submit();
});

mintSubmitButton.on("press", () => {
  mintConfigForm.submit();
});

mintConfigForm.on("submit", () => {
  const repetitionsText = mintRepetitionsInput.getValue().trim();
  let repetitions;
  try {
    repetitions = parseInt(repetitionsText, 10);
    if (isNaN(repetitions) || repetitions < 1 || repetitions > 1000) {
      addLog("Invalid input. Please enter a number between 1 and 1000.", "error");
      mintRepetitionsInput.setValue("");
      screen.focusPush(mintRepetitionsInput);
      safeRender();
      return;
    }
  } catch (error) {
    addLog(`Invalid format: ${error.message}`, "error");
    mintRepetitionsInput.setValue("");
    screen.focusPush(mintRepetitionsInput);
    safeRender();
    return;
  }

  dailyActivityConfig.mintRepetitions = repetitions;
  addLog(`Mint Config set to ${repetitions} repetitions`, "success");
  saveConfig();
  updateStatus();

  mintConfigForm.hide();
  dailyActivitySubMenu.show();
  screen.render();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

mintConfigForm.key(["escape"], () => {
  mintConfigForm.hide();
  dailyActivitySubMenu.show();
  setTimeout(() => {
    if (dailyActivitySubMenu.visible) {
      screen.focusPush(dailyActivitySubMenu);
      dailyActivitySubMenu.select(0);
      safeRender();
    }
  }, 100);
});

dailyActivitySubMenu.key(["escape"], () => {
  dailyActivitySubMenu.hide();
  menuBox.show();
  setTimeout(() => {
    if (menuBox.visible) {
      screen.focusPush(menuBox);
      menuBox.select(0);
      safeRender();
    }
  }, 100);
});

screen.key(["escape", "q", "C-c"], () => {
  addLog("Exiting application", "info");
  clearInterval(statusInterval);
  process.exit(0);
});

async function initialize() {
  loadConfig();
  loadPrivateKeys();
  loadProxies();
  updateStatus();
  updateWallets();
  updateLogs();
  safeRender();
  menuBox.focus();
}

setTimeout(() => {
  adjustLayout();
  screen.on("resize", adjustLayout);
}, 100);

initialize();