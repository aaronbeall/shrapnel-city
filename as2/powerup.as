// POWERUP

// init
stop();
_name = "powerup_mc" + getDepth();
_root.powerups.push(this);

// display item graphics
switch(type){
	case "primary":
		gotoAndStop(type);
		icons_mc.gotoAndStop(_player.wepByName(1, item).id + 1);
		break;
	case "secondary":
		gotoAndStop(type);
		icons_mc.gotoAndStop(_player.wepByName(2, item).id + 1);
		break;
	case "trigger":
	case "lock":
		gotoAndStop(1);
		break;
	default:
		gotoAndStop(item || 1);
}

// keycard names as the HUD inventory shows them
function keyLabel(name){
	var c = name.split("Key").join("");
	return c.charAt(0).toUpperCase() + c.substr(1) + " Keycard";
}

// pickup the powerup
if(!pickup){
	isOver = false;
	pickup = function(){
		var p = _player, pickedup = !persistent;
		
		// powerup response
		switch(type){
			
			// primary weapon ammo
			case "primary":
				var w = p.wepByName(1, item);
				var ammo = Math.min(w.max - w.ammo, quantity);
				if(ammo <= 0){
					pickedup = false;
					break;
				}
				if((w.id > p.weapon1.id && w.ammo <= 0) || p.weapon1.ammo <= 0)
					p.changeWep(1, w.id);
				w.ammo += ammo;
				updateDisplay("wep1");
				notify(this, ammo + "x " + item);
				break;
			
			// secondary weapon ammo
			case "secondary":
				var w = p.wepByName(2, item);
				var ammo = Math.min(w.max - w.ammo, quantity);
				if(ammo <= 0){
					pickedup = false;
					break;
				}
				if((w.id > p.weapon2.id && p.weapons2[w.id].ammo <= 0) || p.weapon2.ammo <= 0)
					p.changeWep(2, w.id);
				w.ammo += ammo;
				updateDisplay("wep2");
				notify(this, ammo + "x " + item);
				break;
			
			// health
			case "health":
				switch(item){
					default:
					case "health":
						if(p.health < p.healthMax){
							quantity = Math.min(p.healthMax - p.health, quantity);
							p.health += quantity;
							cleanPlayer();
							notify(this, "+" + quantity + " health");
						}else{
							pickedup = false;
						}
						break;
					
					case "superHealth":
						p.health = quantity;
						cleanPlayer();
						notify(this, "super health!");
						break;
					
					case "healthMax":
						p.healthMax += quantity;
						p.health += quantity;
						cleanPlayer();
						notify(this, "+" + quantity + " health capacity upgrade");
						break;
					
				}
				if(p.health > p.healthLow){
					p.damage_mc._visible = false;
					p.damage_mc.stop();
				}
				updateDisplay("health");
				break;
			
			// generic trigger
			case "trigger":
				trigger(item);
				break;
			
			// keycard: goes into the HUD inventory (item is its inventory name, e.g. "redKey")
			case "key":
				_inventory.addItem(item, keyLabel(item), this);
				notify(this, keyLabel(item));
				break;
			
			// keycard lock: an invisible pad by a door. With the keycard in the inventory the
			// card flies to the pad and is used up, then the pad sends its unlock trigger
			// (e.g. "door1:open"); without it, a notification says which card is needed
			case "lock":
				pickedup = false;
				if(unlocking)
					break;
				if(_inventory.hasItem(item)){
					unlocking = true;
					registerTrigger(this, "use:" + item);
					onTrigger = function(trig){
						if(trig == "use:" + item && unlocking){
							unlocking = false;
							trigger(unlock);
							_root.powerups.remove(this);
							this.kill();
						}
					}
					_inventory.useItem(item, this);
				}else if(!isOver)
					notify(this, keyLabel(item) + " required");
				break;
			
			/*// changing zones
			case "zoneWarp":
				changeZone(item);
				break;*/
		}
		
		// clean off player ship blastmarks based on amount of health
		function cleanPlayer(){
			var percent = p.health / p.healthMax;
			for(var mc in p.blasts_mc)
				if(Math.random() < percent) p.blasts_mc[mc].removeMovieClip();
		}
		
		
		// messages and notifications
		if(alertNotification) notify(this, alertNotification);
		if(alertMessage) showMessage(alertMessage, alertKillTrigger||{onRollOut:this, linger:alertLinger});
		
		// remove powerup if its been used
		if(pickedup){
			_root.powerups.remove(this);
			if(type != "trigger")
				p.indicate("powerup");
			onPickup();
			this.kill();
		}else{
			
			// persistent trigger events
			if(!isOver){
				isOver = true;
				onOver();
				onEnterFrame = function(){
					if(f++ > 1){
						isOver = false;
						onOut();
						delete onEnterFrame;
					}
				}
			}
			f = 0;
			onTouching();
		}
	}
}