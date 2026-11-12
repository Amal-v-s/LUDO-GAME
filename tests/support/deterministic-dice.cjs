const sequence = String(process.env.LUDO_TEST_DICE || '')
  .split(',').map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= 6);
let index = 0;
if (sequence.length) {
  Math.random = () => (sequence[index++ % sequence.length] - 0.5) / 6;
}
