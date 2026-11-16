const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('X202AgentBoard', () => {
  let board, owner, poster, stranger;
  const NVDA = ethers.encodeBytes32String('NVDA').slice(0, 34);

  beforeEach(async () => {
    [owner, poster, stranger] = await ethers.getSigners();
    board = await (await ethers.getContractFactory('X202AgentBoard')).deploy(poster.address);
  });

  it('only the poster posts counts', async () => {
    await expect(board.connect(stranger).post(NVDA, 5, 0)).to.be.revertedWithCustomError(board, 'NotPoster');
    await expect(board.connect(poster).post(NVDA, 12, 3)).to.emit(board, 'AgentsUpdated');
    const c = await board.counts(NVDA);
    expect(c.waiting).to.equal(12n);
    expect(c.armed).to.equal(3n);
  });

  it('armed can never exceed waiting', async () => {
    await expect(board.connect(poster).post(NVDA, 2, 3)).to.be.revertedWithCustomError(board, 'ArmedAboveWaiting');
  });

  it('only the owner changes the poster', async () => {
    await expect(board.connect(poster).setPoster(stranger.address)).to.be.revertedWithCustomError(board, 'NotOwner');
    await board.setPoster(stranger.address);
    await expect(board.connect(poster).post(NVDA, 1, 0)).to.be.revertedWithCustomError(board, 'NotPoster');
  });
});
