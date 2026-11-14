// main timeline, frame 29 (moved from the FLA timeline)
stop();

//trace([so,so.data,so.data.level])
if(so.data.level){
	continue_btn._alpha = 0;
	onEnterFrame = function(){
		continue_btn._alpha += 10;
		if(continue_btn._alpha >= 100)
			delete onEnterFrame;
	}
}else{
	continue_btn._visible = false;
}

var kb = {};
kb.onKeyUp = function(){
	switch(Key.getCode()){
		case Key.ENTER: case Key.SPACE:
			so.data.level ? continueGame() : gotoAndStop('game');
			break;
	}
}
Key.addListener(kb);
