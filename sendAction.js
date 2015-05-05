'use strict';

var request = require('request');
var _ = require('underscore');

var timeoutMap = {};
function sendEventToSelf(event, sendUrl){
  var selfUrl = sendUrl || process.env.SEND_URL + event.origin;
  
  request({
    method : 'POST',
    json : event,
    url : selfUrl
  },function(error, response){
    if(error) console.error('error sending event to server', error || response.body);
  });
}

function send(event, options, sendUrl) {
  console.log('customSendEvent', event, options);
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
          request({
            method : 'POST',
            json : event,
            url : event.target
          },function(error, response, body ) {
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