const fs = require('fs');
const io = require('socket.io-client');

let stream;
function newStream() {
  stream = fs.createWriteStream(`blaseball-log-${Date.now()}.json`, { flags: 'wx' });
  stream.on('error', (err) => {
    console.error(err);
    newStream();
  });
}
newStream();

const socket = io('https://blaseball.com');
socket.on('gameDataUpdate', (data) => {
  stream.write(`${JSON.stringify(data)}\n`);
});
