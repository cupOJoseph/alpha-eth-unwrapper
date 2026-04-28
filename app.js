const MAINNET = 1;
const RPC_URL = "https://eth-mainnet.g.alchemy.com/v2/WtGzKM0NAY_Mr3rAYlykQWnzPF6JbcHy";

const ALPHA = "0xeea3311250fe4c3268f8e684f7c87a82ff183ec1"; // ibETHv2 / alpha-ETH SafeBoxETH
const CYWETH = "0x41c84c0e2ee0b740cf0d31f63f3b6f627dc6b393"; // Iron Bank / Yearn cyWETH (iWETH)
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];
const ALPHA_ABI = [...ERC20_ABI, "function withdraw(uint256 amount)", "function cToken() view returns (address)"];
const CYWETH_ABI = [...ERC20_ABI, "function redeem(uint256 redeemTokens) returns (uint256)", "function underlying() view returns (address)", "function exchangeRateStored() view returns (uint256)"];
const WETH_ABI = [...ERC20_ABI, "function withdraw(uint256 wad)"];

let web3Modal, externalProvider, provider, signer, account;
let alpha, cyweth, weth;
let balances = { alpha: ethers.constants.Zero, cyweth: ethers.constants.Zero, weth: ethers.constants.Zero };

const $ = (id) => document.getElementById(id);
const els = {
  connect: $("connectBtn"),
  status: $("walletStatus"),
  alphaBalance: $("alphaBalance"),
  cyBalance: $("cyBalance"),
  wethBalance: $("wethBalance"),
  unwrapAlpha: $("unwrapAlphaBtn"),
  redeemCy: $("redeemCyBtn"),
  unwrapWeth: $("unwrapWethBtn"),
  runAll: $("runAllBtn"),
  log: $("log"),
  done: $("doneCard")
};

function addLog(text) {
  const li = document.createElement("li");
  li.textContent = text;
  els.log.prepend(li);
}

function short(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmt(value, decimals = 8, places = 6) {
  const s = ethers.utils.formatUnits(value, decimals);
  const [whole, frac = ""] = s.split(".");
  return frac ? `${whole}.${frac.slice(0, places).replace(/0+$/, "") || "0"}` : whole;
}

function setButtons() {
  const connected = Boolean(account);
  els.unwrapAlpha.disabled = !connected || balances.alpha.isZero();
  els.redeemCy.disabled = !connected || balances.cyweth.isZero();
  els.unwrapWeth.disabled = !connected || balances.weth.isZero();
  els.runAll.disabled = !connected || (balances.alpha.isZero() && balances.cyweth.isZero() && balances.weth.isZero());
  if (connected && balances.alpha.isZero() && balances.cyweth.isZero() && balances.weth.isZero()) {
    els.done.classList.remove("hidden");
  }
}

async function ensureMainnet() {
  const net = await provider.getNetwork();
  if (net.chainId === MAINNET) return;
  if (!externalProvider?.request) throw new Error("Please switch wallet to Ethereum mainnet.");
  await externalProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
  provider = new ethers.providers.Web3Provider(externalProvider);
  signer = provider.getSigner();
}

async function refreshBalances() {
  if (!account) return;
  balances.alpha = await alpha.balanceOf(account);
  balances.cyweth = await cyweth.balanceOf(account);
  balances.weth = await weth.balanceOf(account);
  els.alphaBalance.textContent = `${fmt(balances.alpha, 8)} ibETHv2`;
  els.cyBalance.textContent = `${fmt(balances.cyweth, 8)} iWETH`;
  els.wethBalance.textContent = `${fmt(balances.weth, 18)} WETH`;
  setButtons();
}

async function connect() {
  externalProvider = await web3Modal.connect();
  provider = new ethers.providers.Web3Provider(externalProvider);
  await ensureMainnet();
  signer = provider.getSigner();
  account = await signer.getAddress();
  alpha = new ethers.Contract(ALPHA, ALPHA_ABI, signer);
  cyweth = new ethers.Contract(CYWETH, CYWETH_ABI, signer);
  weth = new ethers.Contract(WETH, WETH_ABI, signer);
  els.status.textContent = `Connected: ${short(account)}`;
  els.connect.textContent = "Wallet connected";
  addLog("Wallet connected on Ethereum mainnet.");
  externalProvider.on?.("accountsChanged", () => window.location.reload());
  externalProvider.on?.("chainChanged", () => window.location.reload());
  await refreshBalances();
}

async function waitTx(tx, label) {
  addLog(`${label}: transaction sent (${short(tx.hash)}). Waiting for confirmation…`);
  await tx.wait();
  addLog(`${label}: confirmed.`);
  await refreshBalances();
}

async function unwrapAlpha() {
  await ensureMainnet();
  await refreshBalances();
  if (balances.alpha.isZero()) return addLog("No alpha-ETH / ibETHv2 balance to unwrap.");
  const tx = await alpha.withdraw(balances.alpha);
  await waitTx(tx, "alpha-ETH → ETH");
}

async function redeemCy() {
  await ensureMainnet();
  await refreshBalances();
  if (balances.cyweth.isZero()) return addLog("No cyWETH / iWETH balance to redeem.");
  const result = await cyweth.callStatic.redeem(balances.cyweth);
  if (!ethers.BigNumber.from(result).isZero()) throw new Error(`iWETH redeem preview failed with code ${result.toString()}`);
  const tx = await cyweth.redeem(balances.cyweth);
  await waitTx(tx, "cyWETH → WETH");
}

async function unwrapWeth() {
  await ensureMainnet();
  await refreshBalances();
  if (balances.weth.isZero()) return addLog("No WETH balance to unwrap.");
  const tx = await weth.withdraw(balances.weth);
  await waitTx(tx, "WETH → ETH");
}

async function runAll() {
  try {
    await unwrapAlpha();
    await redeemCy();
    await unwrapWeth();
    addLog("All available unwrap steps are complete. You can donate crypto to Joe now.");
    els.done.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    addLog(`Stopped: ${err?.message || err}`);
  }
}

window.addEventListener("load", () => {
  web3Modal = new window.Web3Modal.default({
    cacheProvider: false,
    providerOptions: {},
    theme: "dark"
  });
  els.connect.addEventListener("click", () => connect().catch((err) => addLog(err?.message || String(err))));
  els.unwrapAlpha.addEventListener("click", () => unwrapAlpha().catch((err) => addLog(err?.message || String(err))));
  els.redeemCy.addEventListener("click", () => redeemCy().catch((err) => addLog(err?.message || String(err))));
  els.unwrapWeth.addEventListener("click", () => unwrapWeth().catch((err) => addLog(err?.message || String(err))));
  els.runAll.addEventListener("click", runAll);
});
