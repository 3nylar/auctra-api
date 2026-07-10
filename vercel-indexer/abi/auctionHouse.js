export const auctionHouseAbi = [
  { type: "event", name: "AuctionCreated", inputs: [
    { name: "auctionId", type: "uint256", indexed: true },
    { name: "seller", type: "address", indexed: true },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "reservePrice", type: "uint256" },
    { name: "endTime", type: "uint64" },
  ]},
  { type: "event", name: "BidPlaced", inputs: [
    { name: "auctionId", type: "uint256", indexed: true },
    { name: "bidder", type: "address", indexed: true },
    { name: "amount", type: "uint256" },
  ]},
  { type: "event", name: "AuctionExtended", inputs: [
    { name: "auctionId", type: "uint256", indexed: true },
    { name: "newEndTime", type: "uint64" },
  ]},
  { type: "event", name: "AuctionEnded", inputs: [
    { name: "auctionId", type: "uint256", indexed: true },
    { name: "winner", type: "address", indexed: true },
    { name: "amount", type: "uint256" },
  ]},
  { type: "event", name: "AuctionCancelled", inputs: [
    { name: "auctionId", type: "uint256", indexed: true },
  ]},
  { type: "event", name: "RefundWithdrawn", inputs: [
    { name: "bidder", type: "address", indexed: true },
    { name: "amount", type: "uint256" },
  ]},
];
