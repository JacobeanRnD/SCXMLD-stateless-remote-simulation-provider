'use strict';
/*
 * SandboxWorker:
 * Node server, implements a stateless protocol for SCXML simluation.
 * [instanceId, scxml, snapshot or null, event or null] -> snapshot 
 *
 * Also, emits realtime events on the _changes channel, of the form: [instanceId, event]
 * 
 * Caches parsed SCXML JavaScript modules for performance.
 *
 * For now, we send along the entire scxml file as a string. 
 * Later, we should use a URL. If it changed, then we re-parse.
 */

var express = require('express');
var bodyParser = require('body-parser');
var scxml = require('scxml');
var sse = require('./sse');

var SCXML_FILE = '/statechartFolder/index.scxml';
var app = express();
var instanceSubscriptions = [];

app.use(bodyParser.json());

app.post('/start', function (req, res) {
  //This is just to check if container is up or not
  res.sendStatus(200);
});

app.post('/react', function (req, res) {
  var snapshot = req.body.snapshot;
  var id = req.body.id;
  var event = req.body.event;

  scxml.pathToModel(SCXML_FILE, function (err, model) {
    if(err) res.status(500).send(err);

    var sendList = [], cancelList = [];
    var instance = new scxml.scion.Statechart(model, {
      snapshot: snapshot,
      sessionid: id,
      customSend: function (event, options) {
        sendList.push({ event: event, options: options });
      },
      customCancel: function (sendid) {
        cancelList.push({ sendid: sendid });
      }
    });

    instance.registerListener({
      onEntry: publishChanges('onEntry'),
      onExit: publishChanges('onExit')
    });

    //Don't start the instance from the beginning if there is no snapshot
    if(!snapshot) instance.start();

    //Process the event
    if(event) instance.gen(event);

    //Get final configuration
    var conf = instance.getSnapshot();

    return res.send({
      conf: conf,
      sendList: sendList,
      cancelList: cancelList
    });

  }, { require: require });
});

function publishChanges (eventName) {
  return function (stateId) {
    instanceSubscriptions.forEach(function (response) {
      response.write('event: ' + eventName +'\n');
      response.write('data: ' + stateId + '\n\n');
    });
  };
}

var uniqueId = 0;
app.get('/_changes',function(req, res) {
  res.uniqueId = uniqueId++;

  instanceSubscriptions.push(res);

  sse.initStream(req, res, function(){
    res.end();

    instanceSubscriptions = instanceSubscriptions.filter(function (subResponse) {
      if(res.uniqueId === subResponse.uniqueId) {
        return false;
      }

      return true;
    });
  });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    console.log(req.path);
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res) {
        res.status(err.status || 500);
        res.json({
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res) {
    res.status(err.status || 500);
    res.json({
        message: err.message,
        error: {}
    });
});


module.exports = app;
