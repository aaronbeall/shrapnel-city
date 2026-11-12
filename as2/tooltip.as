// TOOLTIP

var PADDING_BELOW = 9;
var PADDING_ABOVE = 2;
var FADE_SPEED = 20;

label_txt.autoSize = "center";
hide();

function show(label, targetMC){
	
	// set content
	label_txt.text = label.toUpperCase();
	back_mc._width = int(label_txt._width + 8);
	back_mc._width = int(back_mc._width / 2) * 2; // make even width for crisp edges
	
	// set layout and position
	var bounds = targetMC.getBounds(_parent);
	var xTarget = int(bounds.xMin + (bounds.xMax - bounds.xMin) / 2);
	var yTarget = int(bounds.yMax + arrow_mc._height + PADDING_BELOW);
	arrow_mc._x = 0;
	arrow_mc.gotoAndStop("top");
	
	// bump against screen edge
	if(xTarget + (_width / 2) > screenWidth){
		var xDif = int((xTarget + _width / 2 - screenWidth));
		xTarget -= xDif;
		arrow_mc._x += xDif;
	}
	
	// mirror when on bottom of screen
	if(yTarget > screenHeight / 2){
		yTarget = int(bounds.yMin - back_mc._height - arrow_mc._height - PADDING_ABOVE);
		arrow_mc.gotoAndStop("bottom");
	}
	
	// if unhiding tooltip position it instantly, otherwise it will tween to new positions
	if(!_visible){
		_visible = true;
		_x = xTarget;
		_y = yTarget;
	}
	
	// transition
	onEnterFrame = function(){
		
		// tween to position (for multiple tooltip sequences)
		_x += (xTarget - _x) / 2;
		_y += (yTarget - _y) / 2;
		
		// fade in
		if(_alpha < 100)
			_alpha += FADE_SPEED;
		
		// check for target rollout
		if(!targetMC.hitTest(_parent._xmouse, _parent._ymouse))
			hide();
	}
	
	// kill on click
	onMouseDown = hide;
}

function hide(){
	_visible = false;
	_alpha = 0;
	onEnterFrame = null;
	onMouseDown = null;
}