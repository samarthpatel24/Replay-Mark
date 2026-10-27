var RMSpike = (function () {
    var context = $.GetContextPanel();
    var root = context;
    while (root.GetParent()) root = root.GetParent();
    var cache;
    try { cache = JSON.parse(root.GetAttributeString("rm_spike_cache", "{}")); } catch (e) { cache = {}; }
    if (!cache.session) cache = { session: "rm_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e9).toString(36), n: 0, pending: null };
    var bridge, match = null, lastTitle = 0, lastSend = 0;

    function label(id, text) { var panel = context.FindChildTraverse(id); if (panel) panel.text = text; }
    function remember() { root.SetAttributeString("rm_spike_cache", JSON.stringify(cache)); }
    function result(text) { label("RMResult", text); $.Msg("[Replay Mark] " + text); }
    function now() {
        var bar = root.FindChildTraverse("TopBar");
        var clocks = bar ? bar.FindChildrenWithClassTraverse("GameTime") : [];
        var value = clocks.length ? clocks[0].text.match(/^(\d+):([0-5]\d)$/) : null;
        return value ? Number(value[1]) * 60 + Number(value[2]) : null;
    }
    function send() {
        if (!bridge) return;
        var url = RMConfig.bridgeUrl + "&session=" + encodeURIComponent(cache.session);
        if (cache.pending) url += "#" + encodeURIComponent(JSON.stringify(cache.pending));
        bridge.SetURL(url);
        lastSend = Date.now();
    }
    function receive(panel, title) {
        if (typeof title !== "string") title = panel;
        if (typeof title !== "string" || title.indexOf("RM1:{") !== 0) return;
        var state;
        try { state = JSON.parse(title.slice(4)); } catch (e) { result("Invalid bridge response"); return; }
        if (state.offline) { label("RMConnection", state.error || "Companion unavailable"); return; }
        lastTitle = Date.now();
        match = state.match;
        cache.n = Math.max(cache.n, state.n || 0);
        label("RMConnection", "Companion connected");
        label("RMMatch", "Active match: " + (match || "none"));
        label("RMCount", "Bookmarks in active match: " + (state.total || 0));
        if (cache.pending && state.n >= cache.pending.n) { cache.pending = null; result("Bookmark saved in companion"); }
        else if (cache.pending && state.failedNonce === cache.pending.n) { cache.pending = null; result(state.error || "Bookmark rejected"); }
        remember();
    }
    function tick() {
        if (!context.IsValid()) return;
        var t = now();
        label("RMClock", "Replay clock: " + (t === null ? "unavailable" : Math.floor(t / 60) + ":" + ("0" + t % 60).slice(-2)));
        if (!lastTitle || Date.now() - lastTitle > 6500) label("RMConnection", "Disconnected: open Replay Mark");
        if (bridge && Date.now() - lastSend >= 3000 && (cache.pending || !lastTitle)) send();
        $.Schedule(0.5, tick);
    }
    function connect() {
        if (typeof RMConfig === "undefined" || !RMConfig.bridgeUrl) { result("Prepare the mod connection before compiling"); return; }
        if (!bridge) {
            bridge = $.CreatePanel("CitadelHTMLPanel", context, "RMBridge");
            bridge.hittest = false;
            bridge.style.width = "2px"; bridge.style.height = "2px"; bridge.style.opacity = "0.01";
            $.RegisterEventHandler("HTMLTitle", bridge, receive);
        }
        send();
    }
    function addBookmark() {
        var t = now();
        if (!match || !lastTitle || Date.now() - lastTitle > 6500) { result("Connect companion and set an active match first"); return; }
        if (t === null) { result("Replay clock is unavailable"); return; }
        if (cache.pending) { result("Waiting for the previous bookmark"); return; }
        var entry = context.FindChildTraverse("RMTitle");
        var title = entry ? entry.text.trim() : "";
        if (!title || title.length > 160) { result("Enter a title between 1 and 160 characters"); return; }
        cache.n += 1;
        cache.pending = { n: cache.n, op: "add", match: match, t: t, title: title, tag: "note", spec: "" };
        remember(); send(); result("Sending bookmark");
    }
    $.Schedule(0, function () { connect(); tick(); });
    return {
        connect: connect,
        addBookmark: addBookmark,
        seekDirect: function () { $.DispatchEvent("CitadelReplaySkipByTime", 30); result("Requested +30s using direct event"); },
        seekContext: function () { $.DispatchEvent("CitadelReplaySkipByTime", context, 30); result("Requested +30s using context event"); },
        spectate: function () { $.DispatchEvent("CitadelConCommand", "spec_player 3"); result("Requested spec_player 3"); },
        camera: function () { $.DispatchEvent("CitadelConCommand", "spec_mode 5"); result("Requested spec_mode 5"); }
    };
})();
