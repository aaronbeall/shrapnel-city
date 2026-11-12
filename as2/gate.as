// LEVEL "WALL SWAP" GATE
// on/off swappable level wall to create collision gates that can open/close

// init
stop();
_name = "gate_mc" + id + getDepth();
_visible = false;
var OPEN = "open", CLOSE = "close";
setGate(status || CLOSE);

// default triggering by id
if(id){
	registerTrigger(this, id + ":open");
	registerTrigger(this, id + ":close");

	if(!onTrigger){
		onTrigger = function(trig){
			if(trig == (id + ":open"))
				setGate(":open");
			else if(trig == (id + ":close"))
				setGate(":close");
		}
	}
}

// change wall to open/close
function setGate(status){
	gotoAndStop(status);
	drawOnLevel(this);
}