'use strict';

var request = require('request'),
    debug = require('debug')('SCXMLD-stateless-remote-simulation-provider');

var timeoutMap = {};
function sendEventToSelf(event, sendOptions) {
  
  if(sendOptions.cookies && Object.keys(sendOptions.cookies).length > 0) {
    //Extra support for ExpressJs and request cookies
    var jar = request.jar();

    Object.keys(sendOptions.cookies).forEach(function (cookieName) {
      jar.setCookie(request.cookie(cookieName + '=' + sendOptions.cookies[cookieName]), sendOptions.uri);
    });

    delete sendOptions.cookies;

    sendOptions.jar = jar;
  }

  sendOptions.json = event;

  debug('sending event to self', sendOptions);

  request(sendOptions, function(error, response){
    if(error) console.error('error sending event to server', error || response.body);
  });
}

function send(event, options, sendOptions) {
	var n;

  switch(event.type) {
    case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
      //normalize to an HTTP event
      //assume this is of the form '/foo/bar/bat'
    case 'http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor':
      if(!event.target) {
        n = function () {
          sendEventToSelf(event, sendOptions);
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
              sendEventToSelf(_.extend(event, { name : 'send.' + event.sendid + '.got.error',  data : error }), sendOptions);
            }else{
              sendEventToSelf(_.extend(event, {
                name : 'send.' + event.sendid + '.got.success', 
                data : {
                  body : body,
                  response : response
                }
              }), sendOptions); 
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
