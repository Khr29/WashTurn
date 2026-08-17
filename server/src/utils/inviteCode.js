const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity

// crypto.randomInt (not Math.random) so invite codes — which double as the
// only credential gating who can join a household — aren't generated from a
// predictable, non-cryptographic PRNG.
function generateInviteCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

module.exports = { generateInviteCode };
