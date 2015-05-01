'use strict';

var os = require('os');
var urlModule = require('url');
var Docker = require('dockerode');
var fs = require('fs');

if(os.type() === 'Darwin'){
  if(!process.env.DOCKER_HOST) {
    throw new Error('Missing DOCKER_HOST environmental variable');
  }

  if(!process.env.DOCKER_CERT_PATH) {
    throw new Error('Missing DOCKER_CERT_PATH environmental variable');
  }

  var url = urlModule.parse(process.env.DOCKER_HOST);
  var docker = new Docker({
        host : url.hostname, 
        port : url.port, 
        protocol: 'https',
        ca: fs.readFileSync(process.env.DOCKER_CERT_PATH + '/ca.pem'),
        cert: fs.readFileSync(process.env.DOCKER_CERT_PATH + '/cert.pem'),
        key: fs.readFileSync(process.env.DOCKER_CERT_PATH + '/key.pem')
      });
}else if(os.type() === 'Linux'){
  if(process.env.DOCKER_HOST) {
    docker = new Docker(urlModule.parse(process.env.DOCKER_HOST));
  } else if(process.env.DOCKER_SOCK) {
    docker = new Docker({socketPath : process.env.DOCKER_SOCK});
  } else {
    docker = new Docker();
  }
}else{
  throw new Error('OS not supported');
}

module.exports = docker;
