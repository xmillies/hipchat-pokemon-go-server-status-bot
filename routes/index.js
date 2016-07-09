var http = require('request');
var cors = require('cors');
var uuid = require('uuid');
var url = require('url');

var fs = require('fs');
var request = require('request');
var cheerio = require('cheerio');
var CircularBuffer = require("circular-buffer");

var lastStatus;
var statuses = new CircularBuffer(3);
var intervals = {};
var REFRESH_RATE = 10 * 1000; // 10 seconds

// This is the heart of your HipChat Connect add-on. For more information,
// take a look at https://developer.atlassian.com/hipchat/tutorials/getting-started-with-atlassian-connect-express-node-js
module.exports = function (app, addon) {
    var hipchat = require('../lib/hipchat')(addon);

    // simple healthcheck
    app.get('/healthcheck', function (req, res) {
        res.send('OK');
    });

    // Root route. This route will serve the `addon.json` unless a homepage URL is
    // specified in `addon.json`.
    app.get('/',
        function (req, res) {
            // Use content-type negotiation to choose the best way to respond
            res.format({
                // If the request content-type is text-html, it will decide which to serve up
                'text/html': function () {
                    var homepage = url.parse(addon.descriptor.links.homepage);
                    if (homepage.hostname === req.hostname && homepage.path === req.path) {
                        res.render('homepage', addon.descriptor);
                    } else {
                        res.redirect(addon.descriptor.links.homepage);
                    }
                },
                // This logic is here to make sure that the `addon.json` is always
                // served up when requested by the host
                'application/json': function () {
                    res.redirect('/atlassian-connect.json');
                }
            });
        }
    );

    // This is an example route that's used by the default for the configuration page
    // https://developer.atlassian.com/hipchat/guide/configuration-page
    app.get('/config',
        // Authenticates the request using the JWT token in the request
        addon.authenticate(),
        function (req, res) {
            // The `addon.authenticate()` middleware populates the following:
            // * req.clientInfo: useful information about the add-on client such as the
            //   clientKey, oauth info, and HipChat account info
            // * req.context: contains the context data accompanying the request like
            //   the roomId
            res.render('config', req.context);
        }
    );

    // This is an example glance that shows in the sidebar
    // https://developer.atlassian.com/hipchat/guide/glances
    app.get('/glance',
        cors(),
        addon.authenticate(),
        function (req, res) {
            res.json({
                "label": {
                    "type": "html",
                    "value": "Server status here!"
                },
                "status": {
                    "type": "lozenge",
                    "value": {
                        "label": "TODO",
                        "type": "error"
                    }
                }
            });
        }
    );

    // This is an example end-point that you can POST to to update the glance info
    // Room update API: https://www.hipchat.com/docs/apiv2/method/room_addon_ui_update
    // Group update API: https://www.hipchat.com/docs/apiv2/method/addon_ui_update
    // User update API: https://www.hipchat.com/docs/apiv2/method/user_addon_ui_update
    app.post('/update_glance',
        cors(),
        addon.authenticate(),
        function (req, res) {
            res.json({
                "label": {
                    "type": "html",
                    "value": "Server status here!"
                },
                "status": {
                    "type": "lozenge",
                    "value": {
                        "label": "TODO",
                        "type": "success"
                    }
                }
            });
        }
    );

    // This is an example sidebar controller that can be launched when clicking on the glance.
    // https://developer.atlassian.com/hipchat/guide/dialog-and-sidebar-views/sidebar
    app.get('/sidebar',
        addon.authenticate(),
        function (req, res) {
            res.render('sidebar', {
                identity: req.identity
            });
        }
    );

    // This is an example dialog controller that can be launched when clicking on the glance.
    // https://developer.atlassian.com/hipchat/guide/dialog-and-sidebar-views/dialog
    app.get('/dialog',
        addon.authenticate(),
        function (req, res) {
            res.render('dialog', {
                identity: req.identity
            });
        }
    );

    // Sample endpoint to send a card notification back into the chat room
    // See https://developer.atlassian.com/hipchat/guide/sending-messages
    app.post('/send_notification',
        addon.authenticate(),
        function (req, res) {
            var card = {
                "style": "link",
                "url": "https://www.hipchat.com",
                "id": uuid.v4(),
                "title": req.body.messageTitle,
                "description": "Great teams use HipChat: Group and private chat, file sharing, and integrations",
                "icon": {
                    "url": "https://hipchat-public-m5.atlassian.com/assets/img/hipchat/bookmark-icons/favicon-192x192.png"
                }
            };
            var msg = '<b>' + card.title + '</b>: ' + card.description;
            var opts = {'options': {'color': 'yellow'}};
            hipchat.sendMessage(req.clientInfo, req.identity.roomId, msg, opts, card);
            res.json({status: "ok"});
        }
    );

    // This is an example route to handle an incoming webhook
    // https://developer.atlassian.com/hipchat/guide/webhooks
    app.post('/webhook',
        addon.authenticate(),
        function (req, res) {
            // console.log(req.body);
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;
            // addon.settings.set(room.id, [], clientId);
            console.log(req.body.item.message.message);
            hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'pong pong')
                .then(function (data) {
                    res.sendStatus(200);
                });
        }
    );

    app.post('/help',
        addon.authenticate(),
        function (req, res) {
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;
            var user = req.body.item.message.from;
            helpString = "<b>/server</b>: Checks the server status. It will send a message to the room with the status of the pokemon go server. It will ping people on the subscriber list if the status changes.<br>" +
                "<b>/help</b>: shows you what the commands do<br/>" +
                "<b>/subs</b>: Displays the ping names of people who will receive notification if the server status changes<br/>" +
                "<b>/add</b>: adds yourself to the subscriber list<br/>" +
                "<b>/remove</b>: removes yourself from the subscriber list<br/>" +
                "<b>/start</b>: starts listening for server status changes" +
                "<b>/stop</b>: stops listening for server status changes";
            sendMessage(req, helpString);
        }
    );

    app.post('/server',
        addon.authenticate(),
        function (req, res) {
            console.log(req.body.item.message.message);
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;

            checkServer(req, function (status, text) {
                sendMessage(req, text);
                if (!interval && (status.includes("Offline") || status.includes("Unstable"))) {
                    lastStatus = status;
                    statuses.enq(status);
                }
            });
        }
    );

    app.post('/add',
        addon.authenticate(),
        function (req, res) {
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;
            var user = req.body.item.message.from;

            addUser(room, user, clientId, function (added) {
                if (added) {
                    sendMessage(req, "added " + user.name + " to subscriber list");
                } else {
                    sendMessage(req, user.name + " is already subscribed");
                }
            });
        }
    );

    app.post('/remove',
        addon.authenticate(),
        function (req, res) {
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;
            var user = req.body.item.message.from;

            removeUser(room, user, clientId, function (removed) {
                if (removed) {
                    sendMessage(req, user.name + " has unsubscribed :(");
                } else {
                    sendMessage(req, user.name + " wasn't subscribed");
                }
            });
        }
    );

    app.post('/subs',
        addon.authenticate(),
        function (req, res) {
            console.log("/subs");
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;
            addon.settings.get(room.id, clientId).then(function (data) {
                console.log(data);
            });

            getMentions(room, clientId, function (names) {
                if (names.length > 0) {
                    var message = "current subs are (ping names): ";
                    names.forEach(function (name) {
                        message += " " + name;
                    });
                    sendMessage(req, message);
                } else {
                    sendMessage(req, "There are no subscribers :(");
                }
            });
        }
    );

    app.post('/start',
        addon.authenticate(),
        function (req, res) {
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;
            getInterval(room, clientId, function (interval) {
                if (!interval) {
                    startInterval(req);
                    sendMessage(req, "I'll let you know if the server status changes");
                } else {
                    sendMessage(req, "I'm already listening for server changes");
                }
            });
        }
    );

    app.post('/stop',
        addon.authenticate(),
        function (req, res) {
            var clientId = req.body.oauth_client_id;
            var room = req.body.item.room;
            getInterval(room, clientId, function (interval) {
                if (interval) {
                    removeInterval(room, clientId, interval);
                    sendMessage(req, "I'm not listening for server changes anymore");
                } else {
                    sendMessage(req, "I'm not listening for server changes");
                }
            });
        }
    );

    function startInterval(req) {
        var clientId = req.body.oauth_client_id;
        var room = req.body.item.room;
        console.log("starting interval for room " + room.name);
        interval = setInterval(function () {
            checkServer(req, function (status, text) {
                if (!seenStatusRecently(status)) {
                    console.log(status + " not seen recently");
                    getMentionsString(room, clientId, function (pings) {
                        sendMessage(req, text + pings, {options: {notify: true}});
                    });
                } else {
                    console.log(status + " seen recently");
                }
                if (status.includes("Online")) {
                    // console.log("stopped interval");
                    clearStatuses();
                    // clearInterval(interval);
                    // interval = false;
                    if (seenStatusRecently("Unstable") || seenStatusRecently("Offline")) {
                        getMentionsString(room, clientId, function (pings) {
                            sendMessage(req, text + pings, {options: {notify: true}});
                        });
                    }
                }
                lastStatus = status;
                statuses.enq(status);
            });
        }, REFRESH_RATE);
        storeInterval(room, clientId, interval);
    }

    function storeInterval(room, clientId, interval) {
        var roomId = room.id;
        intervals[clientId] = intervals[clientId] || {};
        intervals[clientId][roomId] = interval;
        clearStatuses();
    }

    function removeInterval(room, clientId, interval) {
        clearInterval(interval);
        console.log("stopping interval for room " + room.name);
        var roomId = room.id;
        intervals[clientId][roomId] = false;
    }

    function getInterval(room, clientId, callback = function (interval) {}) {
        var roomId = room.id;
        callback(intervals[clientId] && intervals[clientId][roomId]);
    }

    function clearStatuses() {
        while (statuses.size() > 0) {
            statuses.deq();
        }
    }

    function seenStatusRecently(statusString) {
        var arr = statuses.toarray();
        for (var i in arr) {
            var status = arr[i];
            if (status.includes(statusString)) {
                return true;
            }
        }
        return false;
    }

    function getMentionsString(room, clientId, callback) {
        addon.settings.get(room.id, clientId).then(function (data) {
            var mentionNames = "";
            data.pings.forEach(function (user) {
                mentionNames += " @" + user.mention_name;
            });

            callback(mentionNames);
        });
    }

    function getMentions(room, clientId, callback) {
        addon.settings.get(room.id, clientId).then(function (data) {
            var mentionNames = [];
            data.pings.forEach(function (user) {
                mentionNames.push(user.mention_name);
            });

            callback(mentionNames);
        });
    }

    function addUser(room, user, clientId, callback = function (added) {}) {
        addon.settings.get(room.id, clientId).then(function (data) {
            if (!includesUser(data.pings, user)) {
                data.pings.push(user);
                addon.settings.set(room.id, data, clientId);
                callback(true);
            } else {
                callback(false)
            }
        });
    }

    function removeUser(room, user, clientId, callback = function () {}) {
        addon.settings.get(room.id, clientId).then(function (data) {
            var index;
            if (index = includesUser(data.pings, user)) {
                data.pings.splice(index, 1);
                addon.settings.set(room.id, data, clientId);
                callback(user);
            } else {
                callback(false)
            }
        });
    }

    function includesUser(arr, user) {
        for (var index in arr) {
            var storedUser = arr[index];
            if (storedUser.id == user.id) {
                return index;
            }
        }
        return false;
    }

    function sendMessage(req, message, ops = {}) {
        hipchat.sendMessage(req.clientInfo, req.identity.roomId, message, ops);
    }

    function checkServer(req, callback = function (status, text) {}) {
        url = 'http://cmmcd.com/PokemonGo/';
        request(url, function (error, response, text) {
            if (!error) {
                console.log("in check server");
                var $ = cheerio.load(text);
                var status;
                $('.jumbotron table tr td h2').filter(function () {
                    var data = $(this);
                    text = data.text();

                    status = data.children().first().text();

                    console.log(text);
                    callback(status, text);
                });
            }
        });
    }

// Notify the room that the add-on was installed. To learn more about
// Connect's install flow, check out:
// https://developer.atlassian.com/hipchat/guide/installation-flow
    addon.on('installed', function (clientKey, clientInfo, req) {
        var clientId = req.body.oauthId;
        var roomId = req.body.roomId;
        intervals[clientId] = intervals[clientId] || {};
        intervals[clientId][roomId] = intervals[clientId][roomId] || false;
        addon.settings.get(roomId, clientId).then(function (data) {
            data = {pings: []};
            addon.settings.set(roomId, data, clientId);
        });
        hipchat.sendMessage(clientInfo, req.body.roomId, 'The ' + addon.descriptor.name + ' add-on has been installed in this room').then(function (data) {
            hipchat.sendMessage(clientInfo, req.body.roomId, "use /help to find out what I do");
        });
        checkServer({clientInfo: clientInfo}, function (status, text) {
            lastStatus = status;
        });
    });

// Clean up clients when uninstalled
    addon.on('uninstalled', function (id) {
        addon.settings.client.keys(id + ':*', function (err, rep) {
            rep.forEach(function (k) {
                addon.logger.info('Removing key:', k);
                addon.settings.client.del(k);
            });
        });
    });

}
;

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};
