'use strict';

var request = require('request');
var _ = require('underscore'),
    debug = require('debug')('SCXMLD-stateless-remote-simulation-provider');

var timeoutMap = {};
function sendEventToSelf(event, sendUrl){
  var selfUrl = sendUrl || process.env.SEND_URL + event.origin;
  
  var options = {
    method : 'POST',
    json : event,
    url : selfUrl
  };

  debug('sending event to self',options);

  request(options,function(error, response){
    if(error) console.error('error sending event to server', error || response.body);
  });
}

function send(event, options, sendUrl) {
	var n;

  switch(event.type) {
    case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
      //normalize to an HTTP event
      //assume this is of the form '/foo/bar/bat'
    case 'http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor':
      if(!event.target) {
        n = function () {
          sendEventToSelf(event, sendUrl);
        };
      } else {
        n = function(){
          var options = {
            method : 'POST',
            json : event,
            url : event.target
          };
          debug('sending event', options);
          request(options,function(error, response, body ) {
            //ignore the response for now
            /*
            if(error){
              sendEventToSelf(_.extend(event, { name : 'send.' + event.sendid + '.got.error',  data : error }), sendUrl);
            }else{
              sendEventToSelf(_.extend(event, {
                name : 'send.' + event.sendid + '.got.success', 
                data : {
                  body : body,
                  response : response
                }
              }), sendUrl); 
            }
            */
          });
        };
      }

      break;
    default:
      console.log('wrong processor', event.type);
      break;
  }

  var timeoutId = setTimeout(n, options.delay || 0);
  if (options.sendid) timeoutMap[options.sendid] = timeoutId;
}

function cancel (sendid) {
  var timeoutId = timeoutMap[sendid];
  if(timeoutId) {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  send: send,
  cancel: cancel
};
