const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('X202AgentVault', () => {
  let enc, oracle, credit, vault, owner, writer, bot, alice, bob, treasury;
  const FEE = ethers.parseUnits('1000', 18); // launch setting: 1,000 tokens per read, 100% burned
  const key = (s) => ethers.id(`x202-agent:${s}`);
  const A = key('alice-1');
  const nvda = {
    cik: '0001045810', ticker: 'NVDA', period: 'Q2 FY2027', revenue: 96221000000, epsGaap: 2.46, epsAdj: 2.22,
    guidance: 108000000000, acceptedAt: '2026-08-26T20:21:19.000Z', accession: '0001045810-26-000073',
  };

  beforeEach(async () => {
    enc = await import('../src/encode.js');
    [owner, writer, bot, alice, bob, treasury] = await ethers.getSigners();
    oracle = await (await ethers.getContractFactory('X202Oracle')).deploy(writer.address);
    credit = await (await ethers.getContractFactory('TestCredit')).deploy();
    vault = await (await ethers.getContractFactory('X202AgentVault')).deploy(await oracle.getAddress(), bot.address);
    await oracle.connect(writer).publish(...enc.publishArgs(nvda)); // report 0
    for (const u of [alice, bob]) {
      await credit.connect(u).faucet(ethers.parseUnits('10000', 18));
      await credit.connect(u).approve(await vault.getAddress(), ethers.MaxUint256);
    }
  });

  const launch = () => oracle.setPayment(credit.getAddress(), treasury.address, FEE, 10000, false);

  it('no deposit before the token exists; nobody is armed', async () => {
    await expect(vault.connect(alice).deposit(A, FEE)).to.be.revertedWithCustomError(vault, 'NoToken');
    expect(await vault.isArmed(A)).to.equal(false);
  });

  it('deposit arms the agent and binds it to the wallet that funded it', async () => {
    await launch();
    await expect(vault.connect(alice).deposit(A, FEE * 3n)).to.emit(vault, 'Deposited');
    expect(await vault.isArmed(A)).to.equal(true);
    expect(await vault.alertsLeft(A)).to.equal(3n);
    expect(await vault.depositorOf(A)).to.equal(alice.address);
    await expect(vault.connect(bob).deposit(A, FEE)).to.be.revertedWithCustomError(vault, 'NotDepositor');
    await vault.connect(alice).deposit(A, FEE); // top-up by the same wallet
    expect(await vault.alertsLeft(A)).to.equal(4n);
  });

  it('fire: one read per agent per report, 100% burned through the oracle', async () => {
    await launch();
    await vault.connect(alice).deposit(A, FEE * 2n);
    const supply0 = await credit.totalSupply();
    await expect(vault.connect(bot).fire([A], 0)).to.emit(vault, 'Fired').withArgs(A, 0, FEE, FEE);
    expect(await credit.totalSupply()).to.equal(supply0 - FEE);
    expect(await oracle.totalBurned()).to.equal(FEE);
    expect(await oracle.totalReads()).to.equal(1n);
    expect(await credit.balanceOf(treasury.address)).to.equal(0n);
    // same report again: skipped, nothing charged
    await expect(vault.connect(bot).fire([A, A], 0)).to.emit(vault, 'Skipped').withArgs(A, 0, 1);
    expect(await vault.balanceOf(A)).to.equal(FEE);
    expect(await credit.allowance(await vault.getAddress(), await oracle.getAddress())).to.equal(0n);
  });

  it('fire skips agents without enough deposit and keeps going', async () => {
    await launch();
    const B = key('bob-1');
    await vault.connect(alice).deposit(A, FEE);
    await vault.connect(bob).deposit(B, FEE / 2n);
    const C = key('never-funded');
    await expect(vault.connect(bot).fire([B, C, A], 0)).to.emit(vault, 'Fired');
    expect(await vault.totalFired()).to.equal(1n);
    expect(await vault.balanceOf(A)).to.equal(0n);
    expect(await vault.balanceOf(B)).to.equal(FEE / 2n);
    expect(await vault.isArmed(A)).to.equal(false);
  });

  it('only the bot fires, only on a published report', async () => {
    await launch();
    await vault.connect(alice).deposit(A, FEE);
    await expect(vault.connect(alice).fire([A], 0)).to.be.revertedWithCustomError(vault, 'NotOperator');
    await expect(vault.connect(owner).fire([A], 0)).to.be.revertedWithCustomError(vault, 'NotOperator');
    await expect(vault.connect(bot).fire([A], 1)).to.be.revertedWithCustomError(vault, 'UnknownReport');
  });

  it('only the depositor withdraws, at any time; owner and bot cannot', async () => {
    await launch();
    await vault.connect(alice).deposit(A, FEE * 2n);
    await vault.connect(bot).fire([A], 0);
    for (const s of [owner, bot, bob]) await expect(vault.connect(s).withdraw(A, 1n)).to.be.revertedWithCustomError(vault, 'NotDepositor');
    await expect(vault.connect(alice).withdraw(A, FEE * 2n)).to.be.revertedWithCustomError(vault, 'TooMuch');
    const before = await credit.balanceOf(alice.address);
    await vault.connect(alice).withdraw(A, FEE);
    expect(await credit.balanceOf(alice.address)).to.equal(before + FEE);
    expect(await vault.balanceOf(A)).to.equal(0n);
  });

  it('token without burn(): the fee goes to the dead address', async () => {
    const plain = await (await ethers.getContractFactory('PlainToken')).deploy();
    await oracle.setPayment(plain.getAddress(), treasury.address, FEE, 10000, true);
    await plain.transfer(alice.address, FEE);
    await plain.connect(alice).approve(vault.getAddress(), FEE);
    await vault.connect(alice).deposit(A, FEE);
    await vault.connect(bot).fire([A], 0);
    expect(await plain.balanceOf('0x000000000000000000000000000000000000dEaD')).to.equal(FEE);
  });

  it('owner can change the operator, nothing else', async () => {
    await expect(vault.connect(bot).setOperator(bob.address)).to.be.revertedWithCustomError(vault, 'NotOwner');
    await vault.setOperator(bob.address);
    expect(await vault.operator()).to.equal(bob.address);
  });

  it('gas: firing 50 agents in one transaction', async () => {
    await launch();
    const keys = [];
    for (let i = 0; i < 50; i++) { const k = key(`a${i}`); keys.push(k); }
    await credit.connect(alice).faucet(ethers.parseUnits('100000', 18));
    for (const k of keys) await vault.connect(alice).deposit(k, FEE);
    const r = await (await vault.connect(bot).fire(keys, 0)).wait();
    expect(await vault.totalFired()).to.equal(50n);
    console.log(`      gas for 50 agents: ${r.gasUsed} (${r.gasUsed / 50n} per agent)`);
  });
});
