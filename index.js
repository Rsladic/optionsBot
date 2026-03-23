import { ethers } from 'ethers';
import axios from 'axios';

// ─── Config ───────────────────────────────────────────────────────────────────

const FACTORY_ADDRESS = '0xFD15c0c277150Da16323a799226534176F7f91D3';
const WS_RPC          = process.env.WS_RPC    || 'wss://rpc.pulsechain.com';
const TG_TOKEN        = process.env.TG_TOKEN;
const TG_CHAT_ID      = process.env.TG_CHAT_ID;
const EXPLORER        = 'https://ipfs.scan.pulsechain.com';
const APP_URL         = 'https://scadaoptions.com/options';

const MIN_CALL_SCADA  = ethers.parseEther('50000');    // 50,000 SCADA
const MIN_PUT_PLS     = ethers.parseEther('5000000');  // 5,000,000 PLS

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const FACTORY_ABI = [
  'event CallCreated(address indexed option, address indexed issuer, uint256 amount, uint256 strikePrice, uint256 premium, uint256 expiry)',
  'event PutCreated(address indexed option, address indexed issuer, uint256 amount, uint256 strikePrice, uint256 premium, uint256 expiry)',
  'event OptionPurchased(address indexed option, address indexed issuer, address indexed buyer)',
  'function spotPrice() view returns (uint256)',
  'function buyerCost(uint256 premium) view returns (uint256)',
];

const OPTION_ABI = [
  'function getOptionDetails() view returns (tuple(uint8 optionType, uint8 state, address issuer, address buyer, uint256 strikePrice, uint256 amount, uint256 premium, uint256 expiry, uint256 totalStrikeCost, uint256 fee, address feeRecipient))',
];

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtAmount(wei) {
  const n = Number(ethers.formatEther(wei));
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPrice(wei) {
  const n = Number(ethers.formatEther(wei));
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(2).replace(/\.?0+$/, '') + 'K';
  if (n >= 1)         return n.toFixed(2);
  return n.toFixed(6);
}

function fmtExpiry(expiry) {
  const ts   = Number(expiry);
  const now  = Math.floor(Date.now() / 1000);
  const days = Math.round((ts - now) / 86400);
  const date = new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return `in ${days} day${days !== 1 ? 's' : ''} — ${date}`;
}

function itmLabel(spot, strike, isCall) {
  if (spot === 0n) return '';
  const itm = isCall ? spot > strike : spot < strike;
  return itm ? ' ✅ <i>In the money</i>' : ' ❌ <i>Out of the money</i>';
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function send(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) { console.log('[TG]', text); return; }
  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id:                  TG_CHAT_ID,
      text,
      parse_mode:               'HTML',
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error('Telegram error:', e.response?.data || e.message);
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function onCallCreated(option, issuer, amount, strikePrice, premium, expiry, provider) {
  if (amount < MIN_CALL_SCADA) return;

  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const [spot, buyerCostWei] = await Promise.all([
    factory.spotPrice().catch(() => 0n),
    factory.buyerCost(premium).catch(() => premium),
  ]);

  const breakeven = strikePrice + (buyerCostWei * ethers.parseEther('1') / amount);

  const msg = [
    `🟢 <b>CALL Option Listed</b>`,
    ``,
    `📦 SCADA Amount:  <b>${fmtAmount(amount)} SCADA</b>`,
    `💰 Premium:       <b>${fmtAmount(premium)} PLS</b>`,
    `🎯 Strike Price:  <b>${fmtPrice(strikePrice)} PLS/SCADA</b>`,
    `📈 Breakeven:     <b>${fmtPrice(breakeven)} PLS/SCADA</b>`,
    `⏰ Expires:       ${fmtExpiry(expiry)}`,
    spot > 0n ? `📊 Spot Price:    <b>${fmtPrice(spot)} PLS/SCADA</b>${itmLabel(spot, strikePrice, true)}` : null,
    `👤 Issuer:        <code>${shortAddr(issuer)}</code>`,
    ``,
    `<a href="${EXPLORER}/address/${option}">📋 View Option</a> · <a href="${APP_URL}">🚀 Open App</a>`,
  ].filter(l => l !== null).join('\n');

  await send(msg);
}

async function onPutCreated(option, issuer, amount, strikePrice, premium, expiry, provider) {
  const collateral = amount * strikePrice / ethers.parseEther('1');
  if (collateral < MIN_PUT_PLS) return;

  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const [spot, buyerCostWei] = await Promise.all([
    factory.spotPrice().catch(() => 0n),
    factory.buyerCost(premium).catch(() => premium),
  ]);

  const breakeven = strikePrice - (buyerCostWei * ethers.parseEther('1') / amount);

  const msg = [
    `🔴 <b>PUT Option Listed</b>`,
    ``,
    `📦 SCADA Amount:    <b>${fmtAmount(amount)} SCADA</b>`,
    `🔒 PLS Collateral:  <b>${fmtAmount(collateral)} PLS</b>`,
    `💰 Premium:         <b>${fmtAmount(premium)} PLS</b>`,
    `🎯 Strike Price:    <b>${fmtPrice(strikePrice)} PLS/SCADA</b>`,
    `📉 Breakeven:       <b>${fmtPrice(breakeven)} PLS/SCADA</b>`,
    `⏰ Expires:         ${fmtExpiry(expiry)}`,
    spot > 0n ? `📊 Spot Price:      <b>${fmtPrice(spot)} PLS/SCADA</b>${itmLabel(spot, strikePrice, false)}` : null,
    `👤 Issuer:          <code>${shortAddr(issuer)}</code>`,
    ``,
    `<a href="${EXPLORER}/address/${option}">📋 View Option</a> · <a href="${APP_URL}">🚀 Open App</a>`,
  ].filter(l => l !== null).join('\n');

  await send(msg);
}

async function onOptionPurchased(optionAddr, issuer, buyer, provider) {
  const optContract = new ethers.Contract(optionAddr, OPTION_ABI, provider);
  const details = await optContract.getOptionDetails().catch(() => null);
  if (!details) return;

  const { optionType, amount, strikePrice, premium, expiry } = details;
  const isCall = Number(optionType) === 0;

  // Apply same size filters
  if (isCall && amount < MIN_CALL_SCADA) return;
  if (!isCall) {
    const collateral = amount * strikePrice / ethers.parseEther('1');
    if (collateral < MIN_PUT_PLS) return;
  }

  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const spot = await factory.spotPrice().catch(() => 0n);

  const emoji = isCall ? '🟢' : '🔴';
  const type  = isCall ? 'CALL' : 'PUT';

  const msg = [
    `${emoji} <b>${type} Option Purchased!</b>`,
    ``,
    `📦 SCADA Amount:  <b>${fmtAmount(amount)} SCADA</b>`,
    `💰 Premium Paid:  <b>${fmtAmount(premium)} PLS</b>`,
    `🎯 Strike Price:  <b>${fmtPrice(strikePrice)} PLS/SCADA</b>`,
    `⏰ Expires:       ${fmtExpiry(expiry)}`,
    spot > 0n ? `📊 Spot Price:    <b>${fmtPrice(spot)} PLS/SCADA</b>${itmLabel(spot, strikePrice, isCall)}` : null,
    `👤 Buyer:         <code>${shortAddr(buyer)}</code>`,
    ``,
    `<a href="${EXPLORER}/address/${optionAddr}">📋 View Option</a> · <a href="${APP_URL}">🚀 Open App</a>`,
  ].filter(l => l !== null).join('\n');

  await send(msg);
}

// ─── Connection & reconnect ───────────────────────────────────────────────────

async function connect() {
  console.log('Connecting to PulseChain...');
  let provider;

  try {
    provider = new ethers.WebSocketProvider(WS_RPC);
    await provider.ready;

    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);

    factory.on('CallCreated', (option, issuer, amount, strikePrice, premium, expiry) =>
      onCallCreated(option, issuer, amount, strikePrice, premium, expiry, provider).catch(console.error)
    );
    factory.on('PutCreated', (option, issuer, amount, strikePrice, premium, expiry) =>
      onPutCreated(option, issuer, amount, strikePrice, premium, expiry, provider).catch(console.error)
    );
    factory.on('OptionPurchased', (option, issuer, buyer) =>
      onOptionPurchased(option, issuer, buyer, provider).catch(console.error)
    );

    console.log('✅ Listening for events on factory', FACTORY_ADDRESS);

    // Keepalive — detect stale WS connections
    const keepAlive = setInterval(async () => {
      try {
        await provider.getBlockNumber();
      } catch {
        console.warn('Keepalive failed — reconnecting...');
        clearInterval(keepAlive);
        provider.destroy();
        setTimeout(connect, 5000);
      }
    }, 30_000);

    provider.on('error', (err) => {
      console.error('Provider error:', err.message);
      clearInterval(keepAlive);
      provider.destroy();
      setTimeout(connect, 5000);
    });

  } catch (err) {
    console.error('Connection failed:', err.message);
    if (provider) provider.destroy();
    setTimeout(connect, 10_000);
  }
}

connect();
