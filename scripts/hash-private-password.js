const crypto=require('crypto');

if(!process.stdin.isTTY){console.error('Run this command in a terminal so the password is not echoed.');process.exit(1)}
process.stdout.write('Enter a strong private-access password (minimum 16 characters): ');
process.stdin.setRawMode(true);
process.stdin.resume();
let password='';
function finish(){process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');if(password.length<16){console.error('Password must be at least 16 characters.');process.exit(1)}const salt=crypto.randomBytes(16),hash=crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1});password='';console.log('ADMIN_PASSWORD_HASH=scrypt$16384$'+salt.toString('hex')+'$'+hash.toString('hex'));}
process.stdin.on('data',chunk=>{for(const char of chunk.toString()){if(char==='\u0003'){password='';process.stdin.setRawMode(false);process.exit(130)}if(char==='\r'||char==='\n'){finish();return}if(char==='\u007f'||char==='\b'){password=password.slice(0,-1);continue}if(char.charCodeAt(0)>=32&&char.charCodeAt(0)<=126&&password.length<256)password+=char}});
