const MAINNET = 1;
const ALPHA = "0xeea3311250fe4c3268f8e684f7c87a82ff183ec1"; // ibETHv2 / alpha-ETH
const CYWETH = "0x41c84c0e2ee0b740cf0d31f63f3b6f627dc6b393"; // cyWETH / iWETH
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];
const ALPHA_ABI = [...ERC20_ABI, "function withdraw(uint256 amount)"];
const CYWETH_ABI = [...ERC20_ABI, "function redeem(uint256 redeemTokens) returns (uint256)"];
const WETH_ABI = [...ERC20_ABI, "function withdraw(uint256 wad)"];

let modal, ext, provider, signer, account, alpha, cyweth, weth;
let connected = false;

const $ = (id) => document.getElementById(id);
const mainBtn = $("mainBtn");
const statusEl = $("status");
const balancesEl = $("balances");
const messageEl = $("message");
const donateBtn = $("donateBtn");

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.classList.remove("hidden");
}

function short(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUnits(v, decimals, places = 6) {
  const s = ethers.utils.formatUnits(v, decimals);
  const [whole, frac = ""] = s.split(".");
  return frac ? `${whole}.${frac.slice(0, places).replace(/0+$/, "") || "0"}` : whole;
}

function friendlyError(err) {
  const raw = [err?.reason, err?.data?.message, err?.error?.message, err?.message, String(err)].filter(Boolean).join("\n");
  if (raw.includes("credit account cannot redeem")) {
    return "Alpha-ETH redemption is blocked by the underlying Iron Bank contract right now: “credit account cannot redeem.”\n\nThat is a contract-level revert from ibETHv2 → iWETH redeem, not a UI/gas-estimation problem. Manually setting gas will not fix it. If the wallet also has cyWETH/iWETH or WETH, this page will still unwrap those.";
  }
  if (raw.includes("user rejected") || raw.includes("User denied")) return "Transaction rejected in wallet.";
  if (raw.includes("insufficient funds")) return "Wallet does not have enough ETH for gas.";
  return raw.slice(0, 700);
}

async function connect() {
  ext = await modal.connect();
  provider = new ethers.providers.Web3Provider(ext);
  let net = await provider.getNetwork();
  if (net.chainId !== MAINNET) {
    await ext.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
    provider = new ethers.providers.Web3Provider(ext);
  }
  signer = provider.getSigner();
  account = await signer.getAddress();
  alpha = new ethers.Contract(ALPHA, ALPHA_ABI, signer);
  cyweth = new ethers.Contract(CYWETH, CYWETH_ABI, signer);
  weth = new ethers.Contract(WETH, WETH_ABI, signer);
  connected = true;
  statusEl.textContent = `Connected: ${short(account)}`;
  mainBtn.textContent = "Unwrap 100%";
  ext.on?.("accountsChanged", () => window.location.reload());
  ext.on?.("chainChanged", () => window.location.reload());
  await refreshBalances();
}

async function balances() {
  return {
    alpha: await alpha.balanceOf(account),
    cyweth: await cyweth.balanceOf(account),
    weth: await weth.balanceOf(account)
  };
}

async function refreshBalances() {
  const b = await balances();
  balancesEl.innerHTML = [
    `${formatUnits(b.alpha, 8)} ibETHv2 / alpha-ETH`,
    `${formatUnits(b.cyweth, 8)} cyWETH / iWETH`,
    `${formatUnits(b.weth, 18)} WETH`
  ].join("<br>");
  balancesEl.classList.remove("hidden");
  return b;
}

async function wait(tx, label) {
  showMessage(`${label}: transaction sent. Waiting for confirmation…\n${tx.hash}`);
  await tx.wait();
  showMessage(`${label}: confirmed.`);
}

async function unwrapAll() {
  mainBtn.disabled = true;
  donateBtn.classList.add("hidden");
  const notes = [];
  try {
    let b = await refreshBalances();

    if (!b.alpha.isZero()) {
      try {
        await alpha.callStatic.withdraw(b.alpha);
        await wait(await alpha.withdraw(b.alpha), "alpha-ETH → ETH");
      } catch (err) {
        notes.push(friendlyError(err));
      }
    } else {
      notes.push("No alpha-ETH / ibETHv2 balance found.");
    }

    b = await refreshBalances();
    if (!b.cyweth.isZero()) {
      try {
        const preview = await cyweth.callStatic.redeem(b.cyweth);
        if (!ethers.BigNumber.from(preview).isZero()) throw new Error(`cyWETH redeem returned error code ${preview.toString()}`);
        await wait(await cyweth.redeem(b.cyweth), "cyWETH → WETH");
      } catch (err) {
        notes.push(`cyWETH redeem failed: ${friendlyError(err)}`);
      }
    } else {
      notes.push("No cyWETH / iWETH balance found.");
    }

    b = await refreshBalances();
    if (!b.weth.isZero()) {
      try {
        await wait(await weth.withdraw(b.weth), "WETH → ETH");
      } catch (err) {
        notes.push(`WETH unwrap failed: ${friendlyError(err)}`);
      }
    } else {
      notes.push("No WETH balance found.");
    }

    await refreshBalances();
    showMessage(notes.join("\n\n"));
    donateBtn.classList.remove("hidden");
  } finally {
    mainBtn.disabled = false;
  }
}

window.addEventListener("load", () => {
  modal = new window.Web3Modal.default({ cacheProvider: false, providerOptions: {}, theme: "dark" });
  mainBtn.addEventListener("click", async () => {
    try {
      if (!connected) await connect();
      else await unwrapAll();
    } catch (err) {
      showMessage(friendlyError(err));
      mainBtn.disabled = false;
    }
  });
});
