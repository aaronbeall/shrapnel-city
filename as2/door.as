// DOOR
// graphical background element, contains a gate instance which inherits id and status

// init
stop();
_name = "door_mc" + id + getDepth();
var OPEN = "open", CLOSE = "close";

// default id based open/close trigger registration
if(id){
	registerTrigger(this, id + ":open");
	registerTrigger(this, id + ":close");

	if(!onTrigger){
		onTrigger = function(trig){
			if(trig == (id + ":open"))
				open();
			else if(trig == (id + ":close"))
				close();
		}
	}
}

// open - play forward
function open(){
	status = OPEN;
	onEnterFrame = function(){
		nextFrame();
		if(_currentframe == _totalframes)
			delete onEnterFrame;
	}
}

// close - play backward
function close(){
	status = CLOSE;
	onEnterFrame = function(){
		prevFrame();
		if(_currentframe == 2)
			delete onEnterFrame;
	}
}

if(status == OPEN) open();