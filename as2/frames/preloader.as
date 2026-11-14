// interface/preloader, frame 1 (moved from the FLA timeline)
stop();

_root.stop();

this.onEnterFrame = function(){
	bl = _root.getBytesLoaded();
	bt = _root.getBytesTotal();
	percent = Math.ceil((bl/bt)*100);
	var ease = 6;
	this.gotoAndStop( this._currentframe + Math.ceil((percent-this._currentframe)/ease) );
	if(percent==100 && this._currentframe==100){
		_root.play();
		delete this.onEnterFrame;
	}
}

