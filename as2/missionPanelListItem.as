// UI MISSION PANEL LIST ITEM

// params
var OFF_COLOR = label_txt.textColor;
var ON_COLOR = 0x060808;

// init
var locked;
back_mc._visible = false;
if(locked){
	_alpha = 15;
	label_txt.text = label.substr(0, 3) + "***LOCKED***";
}else{
	_alpha = 100;
	label_txt.text = label.toUpperCase();
}

// interaction
function onRollOver(){
	if(!locked){
		label_txt.textColor = ON_COLOR;
		back_mc._visible = true;
		back_mc._width = label_txt._width;
		onEnterFrame = function(){
			back_mc._width += ((label_txt.textWidth + 2) - back_mc._width) * .5;
		}
		useHandCursor = true;
	}else{
		useHandCursor = false;
	}
}

function onRollOut(){
	label_txt.textColor = OFF_COLOR;
	back_mc._visible = false;
	onEnterFrame = null;
}

function onRelease(){
	if(!locked)
		gotoLevel(index);
}