// instance shot_mcShock on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	speed = 25;
	bounce = 0.35;
	drag = .95;
	damage = 50;
	stun = frameRate * 20;
	blastMark = 10;
	blastRange = 500;
	spinSpeed = 25;
	
	function onDie(){
		var d = shotID();
		var mc = _screen.createEmptyMovieClip('mask_mc'+d,d);
		//mc.lineStyle(1,0xff0000,100);
		mc.beginFill(0xffffff,100);
		var count = 90, points = [];
		var i = count;
		while(i--){
			var a = 360*(i/count);
			var v = getVector(10,a);
			var p = {x:_x,y:_y};
			while(!wallHitTest(p.x,p.y)){
				p.x += v.x;
				p.y += v.y;
				//_screen.attachMovie('dot','dot'+_screen.getNextHighestDepth(),_screen.getNextHighestDepth(),{_x:p.x,_y:p.y});
			}
			//_screen.attachMovie('dot','dot'+_screen.getNextHighestDepth(),_screen.getNextHighestDepth(),{_x:p.x,_y:p.y});
			i == count-1 ? mc.moveTo(p.x,p.y) : mc.lineTo(p.x,p.y);
		}
		mc.endFill();
		setMask(mc);
		this.maskMC = mc;
		var bounds = mc.getBounds(mc._parent);
		_xscale = Math.max(Math.abs(_x-bounds.xMin),Math.abs(_x-bounds.xMax))*2;
		_yscale = Math.max(Math.abs(_y-bounds.yMin),Math.abs(_y-bounds.yMax))*2;
		_rotation = 0;
		
		/*var init = {
			_x:_x,
			_y:_y,
			_xscale:_xscale,
			_yscale:_yscale
		}
		var b = _screen.blasts_mc.hit_mc.duplicateMovieClip("blasts_mc"+d,d,init);
		b.gotoAndStop(10);
		b.setMask(mc);
		//b.transform.colorTransform = new flash.geom.ColorTransform(1,1,1,.45,255,255,255,0);
		//b.filters = [new flash.filters.BlurFilter(2,2,3)];
		blasts_bmp.draw(_screen.blasts_mc);
		b.removeMovieClip();
		setMask(mc);*/
	}
}
