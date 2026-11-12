// BASIC ANIMATED BUTTON

stop();
onEnterFrame = null;

var glow = new flash.filters.GlowFilter(0x00ffff, 0, 0, 0, 2, 2);
var glowBlurMax = 25;
var glowBlurSpeed = 5;
var glowAlphaMax = .25;
filters = [glow];

onRollOver = onDragOver = function(){
	onEnterFrame = function(){
		glow.blurX = glow.blurY += glowBlurSpeed;
		glow.alpha = (glow.blurX / glowBlurMax) * glowAlphaMax;
		filters = [glow];
		if(glow.blurX >= glowBlurMax)
			delete onEnterFrame;
	}
}

onRollOut = onDragOut = function(){
	onEnterFrame = function(){
		glow.blurX = glow.blurY -= glowBlurSpeed;
		glow.alpha = (glow.blurX / glowBlurMax) * glowAlphaMax;
		filters = [glow];
		if(glow.blurX <= 0){
			filters = [];
			delete onEnterFrame;
		}
	}
}