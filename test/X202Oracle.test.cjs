const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('X202Oracle', () => {
  let enc, oracle, credit, agent, owner, writer, stranger, treasury;
  const nvda = {
    cik: '0001045810', ticker: 'NVDA', period: 'Q2 FY2027', revenue: 96221000000, epsGaap: 2.46, epsAdj: 2.22,
    guidance: 108000000000, acceptedAt: '2026-08-26T20:21:19.000Z', accession: '0001045810-26-000073',
  };

  beforeEach(async () => {
    enc = await import('../src/encode.js');
    [owner, writer, stranger, treasury] = await ethers.getSigners();
    oracle = await (await ethers.getContractFactory('X202Oracle')).deploy(writer.address);
    credit = await (await ethers.getContractFactory('TestCredit')).deploy();
    agent = await (await ethers.getContractFactory('ReaderAgent')).deploy(await oracle.getAddress());
  });

  it('only the writer can publish, once per filing', async () => {
    await expect(oracle.connect(stranger).publish(...enc.publishArgs(nvda))).to.be.revertedWithCustomError(oracle, 'NotWriter');
    await expect(oracle.connect(writer).publish(...enc.publishArgs(nvda))).to.emit(oracle, 'EarningsPublished');
    await expect(oracle.connect(writer).publish(...enc.publishArgs(nvda))).to.be.revertedWithCustomError(oracle, 'AlreadyPublished');
    expect(await oracle.count()).to.equal(1n);
  });

  it('owner can revoke the writer', async () => {
    await oracle.setWriter(stranger.address);
    await expect(oracle.connect(writer).publish(...enc.publishArgs(nvda))).to.be.revertedWithCustomError(oracle, 'NotWriter');
    await expect(oracle.connect(writer).setWriter(writer.address)).to.be.revertedWithCustomError(oracle, 'NotOwner');
  });

  it('stores the numbers exactly', async () => {
    await oracle.connect(writer).publish(...enc.publishArgs(nvda));
    const r = await oracle.read.staticCall(0);
    expect(r.revenueUsd).to.equal(96221000000n);
    expect(r.epsGaapE4).to.equal(24600n);
    expect(r.epsAdjE4).to.equal(22200n);
    expect(r.guidanceRevenueUsd).to.equal(108000000000n);
    expect(enc.fromBytes(r.ticker)).to.equal('NVDA');
    expect(enc.fromBytes(r.period)).to.equal('Q2 FY2027');
    expect(enc.accessionFromBytes(r.accession)).to.equal('0001045810-26-000073');
    expect(r.secAcceptedAt).to.equal(BigInt(Date.parse(nvda.acceptedAt) / 1000));
  });

  it('reads are free until a payment token is set', async () => {
    await oracle.connect(writer).publish(...enc.publishArgs(nvda));
    await expect(agent.consume(0)).to.emit(oracle, 'EarningsRead').withArgs(0, await agent.getAddress(), 0, 0);
    expect(await agent.lastRevenueUsd()).to.equal(96221000000n);
  });

  it('paid read: agent pays, part is burned, rest goes to treasury', async () => {
    await oracle.connect(writer).publish(...enc.publishArgs(nvda));
    const fee = ethers.parseUnits('10', 18);
    await oracle.setPayment(await credit.getAddress(), treasury.address, fee, 5000, false);
    await expect(agent.consume(0)).to.be.reverted; // no allowance, no balance

    await credit.faucet(fee);
    await credit.transfer(await agent.getAddress(), fee);
    await agent.approvePayment(await credit.getAddress(), fee);
    const supply0 = await credit.totalSupply();
    await expect(agent.consume(0)).to.emit(oracle, 'EarningsRead').withArgs(0, await agent.getAddress(), fee, fee / 2n);
    expect(await credit.totalSupply()).to.equal(supply0 - fee / 2n);
    expect(await credit.balanceOf(treasury.address)).to.equal(fee / 2n);
    expect(await oracle.totalBurned()).to.equal(fee / 2n);
    expect(await agent.lastEpsGaapE4()).to.equal(24600n);
  });

  it('token without burn(): the burned share goes to the dead address', async () => {
    await oracle.connect(writer).publish(...enc.publishArgs(nvda));
    const plain = await (await ethers.getContractFactory('PlainToken')).deploy();
    const fee = ethers.parseUnits('10', 18);
    await oracle.setPayment(await plain.getAddress(), treasury.address, fee, 5000, true);
    await plain.transfer(await agent.getAddress(), fee);
    await agent.approvePayment(await plain.getAddress(), fee);
    await agent.consume(0);
    expect(await plain.balanceOf('0x000000000000000000000000000000000000dEaD')).to.equal(fee / 2n);
    expect(await plain.balanceOf(treasury.address)).to.equal(fee / 2n);
    expect(await oracle.totalBurned()).to.equal(fee / 2n);
  });

  it('token without burn() and burnToDead off: the read fails, nothing is taken', async () => {
    await oracle.connect(writer).publish(...enc.publishArgs(nvda));
    const plain = await (await ethers.getContractFactory('PlainToken')).deploy();
    await oracle.setPayment(await plain.getAddress(), treasury.address, 10n, 5000, false);
    await plain.transfer(await agent.getAddress(), 10n);
    await agent.approvePayment(await plain.getAddress(), 10n);
    await expect(agent.consume(0)).to.be.reverted;
    expect(await plain.balanceOf(await agent.getAddress())).to.equal(10n);
  });

  it('payment token cannot be swapped once set', async () => {
    await oracle.setPayment(await credit.getAddress(), treasury.address, 1, 0, false);
    const other = await (await ethers.getContractFactory('TestCredit')).deploy();
    await expect(oracle.setPayment(await other.getAddress(), treasury.address, 1, 0, false)).to.be.revertedWithCustomError(oracle, 'BadConfig');
  });

  it('latest only moves forward when back-filling older quarters', async () => {
    await oracle.connect(writer).publish(...enc.publishArgs(nvda));
    const older = { ...nvda, period: 'Q1 FY2027', revenue: 81615000000, acceptedAt: '2026-05-20T20:21:19.000Z', accession: '0001045810-26-000051' };
    await oracle.connect(writer).publish(...enc.publishArgs(older));
    const r = await oracle.readLatest.staticCall(1045810);
    expect(enc.fromBytes(r.period)).to.equal('Q2 FY2027');
  });
});
