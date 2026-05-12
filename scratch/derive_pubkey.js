const { SigningKey, ethers } = require('ethers');
const privateKey = '0x598c536dbcda4f5e33638b5d626bd98b771a7fc5be59c4f87a6c088e8d3f184c';
const key = new SigningKey(privateKey);
const publicKey = key.publicKey; // Full uncompressed public key (65 bytes, starts with 0x04)
console.log('Public Key:', publicKey);

// Noir expects x and y coordinates separately (32 bytes each)
const x = publicKey.slice(4, 68);
const y = publicKey.slice(68);

const xBytes = [];
for (let i = 0; i < x.length; i += 2) xBytes.push(parseInt(x.slice(i, i + 2), 16));
const yBytes = [];
for (let i = 0; i < y.length; i += 2) yBytes.push(parseInt(y.slice(i, i + 2), 16));

console.log('x: [' + xBytes.join(', ') + ']');
console.log('y: [' + yBytes.join(', ') + ']');
