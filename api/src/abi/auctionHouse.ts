/** Minimal ABI surface the API needs. Generated from AuctionHouse.sol. */
export const auctionHouseAbi = [
  {
    type: "function",
    name: "createAuction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "reservePrice", type: "uint256" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [{ name: "auctionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "bid",
    stateMutability: "payable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "endAuction",
    stateMutability: "nonpayable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimItem",
    stateMutability: "nonpayable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAuction",
    stateMutability: "nonpayable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "pendingReturns",
    stateMutability: "view",
    inputs: [{ name: "bidder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "auctions",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "reservePrice", type: "uint256" },
      { name: "endTime", type: "uint64" },
      { name: "highestBidder", type: "address" },
      { name: "highestBid", type: "uint256" },
      { name: "ended", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "AuctionCreated",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "tokenContract", type: "address", indexed: false },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "reservePrice", type: "uint256", indexed: false },
      { name: "endTime", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BidPlaced",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "bidder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AuctionExtended",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "newEndTime", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AuctionEnded",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AuctionCancelled",
    inputs: [{ name: "auctionId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "RefundWithdrawn",
    inputs: [
      { name: "bidder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
