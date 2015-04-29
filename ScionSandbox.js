'use strict';

var docker = require('./docker');
var request = require('request');

function createSandbox(options, cb) {
  var sandbox = {};

  var t0 = new Date();
  docker.createContainer({
      Image: options.image,
      Volumes: {
        '/statechartFolder': {}
      },
      Env : 'SEND_URL=' + process.env.SEND_URL,
      Memory: 128000000,
      RestartPolicy: 'no',
      MaximumRetryCount: 10,
      ReadonlyRootfs: true,
      Tty: false
    },
    function(err, container) {
      console.log(err, container);
      if (err) return cb(err);
      console.log('Created container');

      sandbox.container = container;

      container.attach({
        stream: true,
        stdout: true,
        stderr: true
      }, function(err, stream) {
        stream.pipe(process.stdout);
      });

      var t1 = new Date();
      console.log('ms until created', t1 - t0);
      container.start({
        'Binds': [options.statechartFolder + ':/statechartFolder']
      }, function(err, data) {
        if (err) return cb(err);
        console.log('Started container');

        sandbox.container = container;

        var t2 = new Date();
        console.log('ms until started', t2 - t1);
        container.inspect(function(err, info) {
          if (err) return cb(err);
          console.log('Container info');

          sandbox.pid = info.State.Pid;
          sandbox.ip = info.NetworkSettings.IPAddress;
          sandbox.startedAt = new Date(info.State.StartedAt);
          sandbox.id = container.id;

          console.log(sandbox.pid, sandbox.ip);

          var t3 = new Date();
          console.log('ms to inspect', t3 - t2);

          function waitUntilReady() {
            console.log('Server not ready yet', sandbox.ip);
            var url = 'http://' + sandbox.ip + ':3000/start';
            request({
              url: url,
              method: 'POST'
            }, function(err, res) {
              console.log('err', err);
              if (err) return setTimeout(waitUntilReady, 100);

              if (res.statusCode !== 200) return setTimeout(waitUntilReady, 100);

              var t4 = new Date();
              console.log('ms until ready', t4 - t3);
              console.log('ms total to bring up new container', t4 - t0);
              return cb(null, sandbox);
            });
          }

          setTimeout(waitUntilReady, 100);
        });
      });
    }
  );
}

module.exports = createSandbox;