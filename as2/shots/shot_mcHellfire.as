// instance shot_mcHellfire on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent (load) {
	// params
	speed = 0;
	//fragCount = 3;
	frag = "shot_mcSeeker";
	fragSpread = 35;
	
	function onInit(){
		var angles = [_rotation - fragSpread / 2, _rotation, _rotation + fragSpread / 2];
		var i = angles.length;
		while(i--){
			var d = shotID();
			var init = {
				_x:_x,
				_y:_y,
				_rotation:angles[i]
			}
			_screen.shot_mcSeeker.duplicateMovieClip("shot_mc" + d, d, init);
		}
		hitFunc();
	}
}

