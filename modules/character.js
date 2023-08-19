/******************************
  Variables & Libs
*******************************/

const config = require('../config').production;
const helper = require('../helper');
const dcserver = require('./dcserver');
const item = require('./item');
const xivcollect = require('./xivcollect');
const axios = require('axios');
const Discord = require("discord.js");
const lodash = require('lodash');
const moment = require("moment");
const nodeHtmlToImage = require('node-html-to-image')
const fs = require("fs");

const pool = config.getPool();
const readPool = config.getReadPool();

const redis = config.getRedis();

/******************************
  Functions
*******************************/

const setUserInfo = async function(userID, dc, server, region, firstname, lastname, lodestone_id) {

  let curr_datetime = moment().format('YYYY-M-D HH:mm:ss');

  await pool.query(
    `INSERT INTO users
      (user_id, lodestone_id, dc, server, region, firstname, lastname, date_added, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE lodestone_id = VALUES(lodestone_id), dc = VALUES(dc), server = VALUES(server), region = VALUES(region), firstname = VALUES(firstname), lastname = VALUES(lastname), last_updated = VALUES(last_updated)`,
    [
      userID,
      lodestone_id,
      dc,
      server,
      region,
      firstname,
      lastname,
      curr_datetime,
      curr_datetime
    ]
  );

  // Reset redis key
  let redisKey = "kweh_user:" + userID;
  let user = {
    id: userID,
    lodestone_id: lodestone_id,
    dc: dc,
    server: server,
    region: region,
    firstname: firstname,
    lastname: lastname
  };
  redis.set(redisKey, JSON.stringify(user), "EX", config.redisExpiry);
}

const getUserInfo = async function(userID) {
  let user = {};

  // Check redis first before db
  let redisKey = "kweh_user:" + userID;
  let userFrRedis = await redis.get(redisKey).then(function (result) {
    return result;
  });

  if( userFrRedis ) {
    user = JSON.parse(userFrRedis);
  }
  else {
    user = await readPool.query("SELECT * FROM users WHERE user_id = ?", [userID]).then(function(res){
      if( res.length > 0 ) {
        return {
          id: userID,
          lodestone_id: res[0].lodestone_id,
          dc: res[0].dc,
          server: res[0].server,
          region: res[0].region,
          firstname: res[0].firstname,
          lastname: res[0].lastname
        }
      }
    });

    if( lodash.isEmpty(user) == false ) {
      redis.set(redisKey, JSON.stringify(user), "EX", config.redisExpiry);
    }
  }

  return user;
}

const searchCharacterOwnServer = async function(server, firstname, lastname){

  server = lodash.capitalize(server)

  let apiUrl = "https://kwehbot.xyz/api/characterIDSearch/" + encodeURI(firstname.replace("’", "'")) + "+" + encodeURI(lastname.replace("’", "'")) + "/" + encodeURI(server);

  console.log("Character Search (Own Server) Api URL: " + apiUrl);

  let characterSearchResult = {};

  await axios.get(apiUrl).then(async function(response){
    if( response.status === 200 ) {
      if( response.data && response.data.id ) {
        characterSearchResult.lodestone_id = response.data.id
        characterSearchResult.firstname = response.data.firstname
        characterSearchResult.lastname = response.data.lastname
        characterSearchResult.dc = response.data.dc
      }
    }
  })
  .catch(function(err){
    console.log(err);
  });

  return characterSearchResult;
}

const searchCharacter = async function(server, firstname, lastname){

  server = lodash.capitalize(server)

  let apiUrl = config.xivApiBaseURL + "character/search?name=" + encodeURI(firstname.replace("’", "'")) + "+" + encodeURI(lastname.replace("’", "'")) + "&server=" + encodeURI(server);
  apiUrl += "&private_key=" + config.xivApiToken;

  console.log("Character Search Api URL: " + apiUrl);

  let characterSearchResult = {};

  await axios.get(apiUrl).then(async function(response){
    if( response.status === 200 ) {
      if( response.data.Pagination.Results > 0 && response.data.Results.length > 0 ) {

        if( response.data.Results.length == 1 ) {
          characterSearchResult = {
            "dc": response.data.Results[0].Server ? response.data.Results[0].Server : "",
            "firstname": response.data.Results[0].Name ? response.data.Results[0].Name.split(" ")[0] : "",
            "lastname": response.data.Results[0].Name ? response.data.Results[0].Name.split(" ")[1] : "",
            "lodestone_id": response.data.Results[0].ID ? response.data.Results[0].ID : 0
          };
        }
        else {
          for(var i=0; i<response.data.Results.length; i++) {
            if( response.data.Results[i].Name.toLowerCase() === firstname + " " + lastname ) {
              characterSearchResult = {
                "dc": response.data.Results[i].Server ? response.data.Results[i].Server : "",
                "firstname": response.data.Results[i].Name ? response.data.Results[i].Name.split(" ")[0] : "",
                "lastname": response.data.Results[i].Name ? response.data.Results[i].Name.split(" ")[1] : "",
                "lodestone_id": response.data.Results[i].ID ? response.data.Results[i].ID : 0
              };
              break;
            }
          }
        }
      }
    }
  })
  .catch(function(err){
    console.log(err);
  });

  return characterSearchResult;
}

const searchCharacterByLodestoneID = async function(lodestone_id){
  let apiUrl = config.xivApiBaseURL + "character/" + lodestone_id;
  apiUrl += "?private_key=" + config.xivApiToken;

  console.log("Character Search Api (Lodestone ID) URL: " + apiUrl);

  let characterSearchResult = {};

  await axios.get(apiUrl).then(async function(response){
    if( response.status === 200 ) {
      if( response.data.Character ) {
        characterSearchResult = {
          "dc": response.data.Character.Server ? response.data.Character.Server : "",
          "firstname": response.data.Character.Name ? response.data.Character.Name.split(" ")[0] : "",
          "lastname": response.data.Character.Name ? response.data.Character.Name.split(" ")[1] : "",
          "lodestone_id": lodestone_id
        };
      }
    }
  })
  .catch(function(err){
    console.log(err);
  });

  return characterSearchResult;
}

const getCharacterInfoOwnServer = async function(userInfo, language) {

  let characterInfo = {};
  let apiUrl = "https://kwehbot.xyz/api/profile/" + userInfo.lodestone_id + "/" + language;

  await axios.get(apiUrl).then(async function(response){
    if( response.status === 200 ) {
      if( response.data && response.data.name ) {
        characterInfo = response.data;
        characterInfo.ID = userInfo.lodestone_id;
      }
    }
  })
  .catch(function(err){
    console.log(err);
  });

  if( lodash.isEmpty(characterInfo) == false ) {

    characterInfo["Character"] = {
      "ClassJobs": []
    };

    for(var key in config.classes) {
      let jobData = characterInfo.jobs.filter(j => j.en == config.classes[key]);

      characterInfo["Character"]["ClassJobs"].push({
        "ClassID": key,
        "Level": jobData.length > 0 ? jobData[0].level : 0
      });
    }
  }

  return characterInfo;
}

const getCharacterInfoXIVAPI = async function(userInfo, getDetailedProfile=true) {

  let characterInfo = {};
  let apiUrl = config.xivApiBaseURL + "character/" + userInfo.lodestone_id + "?private_key=" + config.xivApiToken;

  if( getDetailedProfile ) {
      apiUrl += "&data=CJ,FC,MIMO";
  }
  else {
      apiUrl += "&data=CJ";
  }

  await axios.get(apiUrl).then(async function(response){
    if( response.status === 200 ) {
      if( response.data && response.data.Character.Name ) {
        characterInfo = response.data;
      }
    }
  })
  .catch(function(err){
    console.log(err);
  });

  return characterInfo;
}

const getCharacterTitle = async function(titleID) {

  let titleInfo = {};
  let apiUrl = config.xivApiBaseURL + "search";
  apiUrl += "?private_key=" + config.xivApiToken;

  await axios.post(apiUrl, {
    "indexes": "title",
    "columns": "",
    "body": {
      "query": {
        "bool": {
          "filter": [
            {
              "term": {
                "ID": titleID
              }
            }
          ]
        }
      }
    }
  }).then(async function(response){
    if( response.status === 200 ) {
      if( response.data && response.data.Pagination.Results > 0 ) {
        titleInfo = response.data.Results;
      }
    }
  })
  .catch(function(err){
    console.log(err);
  });

  return titleInfo;
}

const printGlamInfo = async function(characterInfo, message) {

  let name = characterInfo.Character.Name;
  let race = config.races[characterInfo.Character.Race];
  let current_level = characterInfo.Character.ActiveClassJob.Level;
  let current_job = characterInfo.Character.ActiveClassJob.UnlockedState.Name;
  let gender = characterInfo.Character.Gender == 1 ? ':male_sign:' : ':female_sign:';

  let avatar = characterInfo.Character.Avatar; // small
  let portrait = characterInfo.Character.Portrait; // big

  // Embed
  let embed = new Discord.MessageEmbed()
    .setColor(config.defaultEmbedColor)
    .setImage(portrait)
    .setAuthor({name: name + " - Glamours", iconURL: avatar})
    .setDescription("Level " + current_level + " " + race + " " + current_job + " " + gender);

  let glam_slots = [
    'Head', 'Body', 'Hands', 'Legs', 'Feet',
    'Earrings', 'Bracelets', 'Necklace', 'Ring1', 'Ring2',
    'MainHand', 'OffHand'
  ];

  let glam_name_map = {
    'Head'      : 'Head',
    'Body'      : 'Body',
    'Hands'     : 'Hands',
    'Legs'      : 'Legs',
    'Feet'      : 'Feet',
    'Earrings'  : 'Earrings',
    'Bracelets' : 'Bracelets',
    'Necklace'  : 'Necklace',
    'Ring1'     : 'Ring 1',
    'Ring2'     : 'Ring 2',
    'MainHand'  : 'Main Hand',
    'OffHand'   : 'Off Hand'
  }

  for(var i=0; i<glam_slots.length; i++) {
    let glam = {};

    if( characterInfo.Character.GearSet.Gear[ glam_slots[i] ] && characterInfo.Character.GearSet.Gear[ glam_slots[i] ].Mirage ) {
      glam = await item.getItemByID( characterInfo.Character.GearSet.Gear[ glam_slots[i] ].Mirage );
    }
    else if( characterInfo.Character.GearSet.Gear[ glam_slots[i] ] && characterInfo.Character.GearSet.Gear[ glam_slots[i] ].ID ) {
      glam = await item.getItemByID( characterInfo.Character.GearSet.Gear[ glam_slots[i] ].ID );
    }

    let dyeName = '';

    if( characterInfo.Character.GearSet.Gear[ glam_slots[i] ] && characterInfo.Character.GearSet.Gear[ glam_slots[i] ].Dye ) {
      if( characterInfo.Character.GearSet.Gear[ glam_slots[i] ].Dye != null ) {
        let dye = await item.getItemByID( characterInfo.Character.GearSet.Gear[ glam_slots[i] ].Dye );
        dyeName = "\n+ [" + dye["Name"] + "](" + config.teamcraftBaseURL + "en/item/" + dye["ID"] + ")";
      }
    }

    if( lodash.isEmpty(glam) ) {
      embed.addFields({ name: glam_name_map[glam_slots[i]], value: "None", inline: true });
    }
    else {
      let glamName = "[" + glam.Name + "](" + config.teamcraftBaseURL + "en/item/" + glam.ID + ")";
      embed.addFields({ name: glam_name_map[glam_slots[i]], value: glamName + dyeName, inline: true });
    }
  }

  // Links
  let links = "[Lodestone]("+config.lodestoneURL+characterInfo.Character.ID+")";
  embed.addFields({ name: "Links", value: links });

  // Channel
  let channel = message.serverSettings["default_channel"] ? message.serverSettings["default_channel"] : message.channel;

  // Send Message
  channel.send({ embeds: [embed] }).catch(function(err){
    console.log(err);
  });
}

const printCharacterInfo = async function(characterInfo, message) {

  let name, race, data_center, server, current_level, current_job, fc, fc_tag, title, avatar, portrait, profileImg = "";
  let files = [];

  try {
    name = characterInfo.name;
    race = characterInfo.race;
    data_center = characterInfo.datacenter;
    server = characterInfo.Character.server;
    current_level = characterInfo.level;
    current_job = characterInfo.job;
    fc = characterInfo.fc;
    fc_tag = characterInfo.fc_tag;
    title = characterInfo.title;
    avatar = characterInfo.avatar; // small
    portrait = characterInfo.portrait // big
  }
  catch(err) {
    helper.sendErrorMsg("Error", "Unable to retrieve character information", message);
    console.error("CHARACTER INFO ERROR", err);
    return
  }

  // Embed
  let embed = new Discord.MessageEmbed()
    .setColor(config.defaultEmbedColor);

  // Image Source
  let userProfile = await getUserProfile(characterInfo.ID);
  let isGenerated = false;

  // Generate if no profile or if profile is older than 1 hour
  if( lodash.isEmpty(userProfile) || moment(userProfile.last_updated).unix() < moment().subtract(1, 'hour').unix() ) {
    profileImg = await generateUserProfile(characterInfo, message);
    let attachment = new Discord.MessageAttachment(profileImg);
    embed.setImage("attachment://" + profileImg.split("/")[ profileImg.split("/").length -1 ]);
    files.push(attachment)
    isGenerated = true;
  } else {
    // From DB
    profileImg = userProfile.url
    embed.setImage(profileImg);
  }

  // Default Image
  if( !profileImg ) {
    embed.setImage(portrait);
  }

  // Title
  if( title ) {
    embed.setAuthor({name: name + ", " + title, iconURL: avatar});
  }
  else {
    embed.setAuthor({name: name, iconURL: avatar});
  }

  // Body
  embed.addFields({ name: "Current Job", value: "Level " + current_level + " " + race + " " + current_job });

  if( fc ) {
    embed.addFields({ name: "Free Company", value: fc + " «"+fc_tag+ "»" });
  }

  // Minions, Mounts, Achievements
  if( characterInfo.minions ) {
    embed.addFields({ name: "Minions", value: characterInfo.minions + " / " + config.totalMinions + " ("+Math.round(characterInfo.minions/config.totalMinions*100)+"%)", inline: true });
  }

  if( characterInfo.mounts ) {
    embed.addFields({ name: "Mounts", value: characterInfo.mounts + " / " + config.totalMounts + " ("+Math.round(characterInfo.mounts/config.totalMounts*100)+"%)", inline: true });
  }

  // Links
  let links = "";

  // Lodestone
  links += "\n[Lodestone]("+config.lodestoneURL+characterInfo.ID+")";

  // FFXIV Collect
  links += "\n[FFXIV Collect](https://ffxivcollect.com/characters/"+characterInfo.ID+")";

  // FFLogs
  let region = dcserver.getDCregion(data_center);
  links+= "\n[FFLogs]("+config.fflogsBaseURL+"character/"+region+"/"+characterInfo.server+"/"+name.replace(" ","%20")+")";

  // Triple Triad
  if( characterInfo.discordID ) {
    links+= "\n[Triple Triad Tracker](https://triad.raelys.com/users/"+characterInfo.discordID+")";
  }

  embed.addFields({ name: "Links", value: links });

  // Channel
  let channel = message.serverSettings["default_channel"] ? message.serverSettings["default_channel"] : message.channel;

  // Send Message
  channel.send({ embeds: [embed], files: files }).catch(function(err){
    helper.handleDiscordError(err, message)
  }).then(function(m){

    // Save Image Record
    if( m && m.embeds && m.embeds.length && m.embeds[0].image.url ) {
      setUserProfile(characterInfo.ID, m.embeds[0].image.url);
    }

    // Delete local img
    if( isGenerated ) {
      fs.unlink(profileImg, (err) => {
        if (err) {
          console.error(err);
          return;
        }
      });
    }
  });
}

/******************************
  Character Profile Img
*******************************/

const getUserProfile = async function(lodestone_id) {
  let userProfile = {};

  userProfile = await readPool.query("SELECT * FROM user_profile WHERE lodestone_id = ?", [lodestone_id]).then(function(res){
    if( res.length > 0 ) {
      return {
        id: lodestone_id,
        url: res[0].url,
        last_updated: res[0].last_updated,
      }
    }
  });

  return userProfile;
}

const setUserProfile = async function(lodestone_id, url) {

  let curr_datetime = moment().format('YYYY-M-D HH:mm:ss');

  await pool.query(
    `INSERT INTO user_profile
      (lodestone_id, url, date_added, last_updated) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE url = VALUES(url), last_updated = VALUES(last_updated)`,
    [
      lodestone_id,
      url,
      curr_datetime,
      curr_datetime
    ]
  );
}

const generateUserProfile = async function(characterInfo, message) {

  let userProfileURL = "";

  if( characterInfo.name && characterInfo.ID ) {
    let outputPath = config.profileImgPath + characterInfo.ID + ".png";
    let charHtml = getUserProfileHTML(characterInfo);

    await nodeHtmlToImage({
      output: outputPath,
      transparent: true,
      html: charHtml
    })
    .catch(e => console.log(e));

    return outputPath;
  }

  return "";
}

const getUserProfileHTML = function(characterInfo) {

  // Avatar
  let avatar = characterInfo.portrait ? characterInfo.portrait : '';

  // Name
  let displayName = characterInfo.name ? characterInfo.name : '';

  // Title
  let displayTitle = characterInfo.title ? characterInfo.title : "";

  // Server & DC
  let server = characterInfo.server ? characterInfo.server : "";
  let dc = characterInfo.datacenter ? characterInfo.datacenter : "";

  // FC
  let fc = characterInfo.fc ? characterInfo.fc : "";
  let fc_tag = characterInfo.fc_tag ? characterInfo.fc_tag : "";

  // Minions & Mounts
  let displayMinions = "";

  if( characterInfo.minions ) {
    displayMinions = Math.round(characterInfo.minions/config.totalMinions*100)+"%";
  }

  let displayMounts = "";

  if( characterInfo.mounts ) {
    displayMounts = Math.round(characterInfo.mounts/config.totalMounts*100)+"%";
  }

  // Jobs

  // DoW / DoM
  let pld_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 19)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 19)[0].Level : 0;
  let war_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 21)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 21)[0].Level : 0;
  let drk_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 32)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 32)[0].Level : 0;
  let gnb_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 37)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 37)[0].Level : 0;

  let whm_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 24)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 24)[0].Level : 0;
  let sch_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 28)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 28)[0].Level : 0;
  let ast_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 33)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 33)[0].Level : 0;
  let sge_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 40)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 40)[0].Level : 0;

  let mnk_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 20)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 20)[0].Level : 0;
  let drg_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 22)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 22)[0].Level : 0;
  let nin_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 30)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 30)[0].Level : 0;
  let sam_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 34)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 34)[0].Level : 0;
  let rpr_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 39)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 39)[0].Level : 0;

  let brd_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 23)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 23)[0].Level : 0;
  let mch_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 31)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 31)[0].Level : 0;
  let dnc_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 38)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 38)[0].Level : 0;

  let blm_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 25)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 25)[0].Level : 0;
  let sum_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 27)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 27)[0].Level : 0;
  let rdm_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 35)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 35)[0].Level : 0;
  let blu_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 36)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 36)[0].Level : 0;

  // Pre-Crystal
  let gld_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 1)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 1)[0].Level : 0;
  let mrd_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 3)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 3)[0].Level : 0;

  let cnj_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 6)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 6)[0].Level : 0;
  let acn_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 26)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 26)[0].Level : 0;

  let pug_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 2)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 2)[0].Level : 0;
  let lnc_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 4)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 4)[0].Level : 0;
  let rog_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 29)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 29)[0].Level : 0;

  let arc_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 5)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 5)[0].Level : 0;

  let thm_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 7)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 7)[0].Level : 0;

  // DoH
  let crp_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 8)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 8)[0].Level : 0;
  let bsm_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 9)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 9)[0].Level : 0;
  let arm_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 10)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 10)[0].Level : 0;
  let gsm_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 11)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 11)[0].Level : 0;
  let ltw_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 12)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 12)[0].Level : 0;
  let wvr_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 13)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 13)[0].Level : 0;
  let alc_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 14)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 14)[0].Level : 0;
  let cul_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 15)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 15)[0].Level : 0;

  // DoL
  let min_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 16)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 16)[0].Level : 0;
  let bot_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 17)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 17)[0].Level : 0;
  let fsh_level = characterInfo.Character.ClassJobs.filter(j => j.ClassID == 18)[0] ? characterInfo.Character.ClassJobs.filter(j => j.ClassID == 18)[0].Level : 0;

  // let jobIconBasePath = "https://raw.githubusercontent.com/xivapi/classjob-icons/master/icons/";
  let jobIconBasePath = "https://kwehbot.xyz/icons/";

  let html = `
<html>
  <head>
    <link href="https://fonts.googleapis.com/css?family=Open+Sans:400,400i,700,700i&display=fallback" rel="stylesheet">
  </head>
  <body>
    <div class="main-container">
      <div class="left-col"></div>
      <div class="right-col">
        <div class="right-col-overlay"></div>
        <div class="right-col-content">

          <div>
            <div class="right-col-item">
              <div class="title">`+displayTitle+`</div>
              <div class="name">`+displayName+`</div>
            </div>
          </div>`;

  if( fc && fc_tag ) {
    html += `
          <div>
            <div class="right-col-item">
              <div class="fc-label">Free Company</div>
              <div class="fc-name">`+fc+`</div>
              <div class="fc-tag">`+fc_tag+`</div>
            </div>
          </div>
    `;
  }

  html += `
          <div>
            <div class="right-col-item">
              <div class="fc-label">Server</div>
              <div class="server-dc-name">`+server+` / `+dc+`</div>
            </div>
          </div>
  `;

  if( displayMounts && displayMinions ) {
    html += `
          <div>
            <div class="right-col-item">
              <div style="display: flex; flex-direction: row; justify-content: space-between; width: 100%;">
                <div style="width: 50%;">
                  <div class="collection-label">Minions</div>
                  <div>`+displayMinions+`</div>
                </div>
                <div style="width: 50%;">
                  <div class="collection-label">Mounts</div>
                  <div>`+displayMounts+`</div>
                </div>
              </div>
            </div>
          </div>
    `;
  }

  html += `
          <div>
            <div class="jobs text-left right-col-item">
              <div class="dow">
                <div class="job-label">DoW / DoM</div>
                <div class="job-container">
                  <div class="tanks" style="width: 33%;">
                    <div class="job"><img src="`+jobIconBasePath+(pld_level>0?'paladin':'gladiator')+`.png" class="job-icon"><br/>`+(pld_level>0?pld_level:gld_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+(pld_level>0?'warrior':'marauder')+`.png" class="job-icon"><br/>`+(war_level>0?war_level:mrd_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`darkknight.png" class="job-icon"><br/>`+drk_level+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`gunbreaker.png" class="job-icon"><br/>`+gnb_level+`</div>
                  </div>

                  <div class="healers" style="width: 33%; padding-left: 15px;">
                    <div class="job"><img src="`+jobIconBasePath+(whm_level>0?'whitemage':'conjurer')+`.png" class="job-icon"><br/>`+(whm_level>0?whm_level:cnj_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+(sch_level>0?'scholar':'arcanist')+`.png" class="job-icon"><br/>`+(sch_level>0?sch_level:acn_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`astrologian.png" class="job-icon"><br/>`+ast_level+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`sage.png" class="job-icon"><br/>`+sge_level+`</div>
                  </div>

                  <div class="melee" style="width: 33%;">
                    <div class="job"><img src="`+jobIconBasePath+(drg_level>0?'dragoon':'lancer')+`.png" class="job-icon"><br/>`+(drg_level>0?drg_level:lnc_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+(mnk_level>0?'monk':'pugilist')+`.png" class="job-icon"><br/>`+(mnk_level>0?mnk_level:pug_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+(nin_level>0?'ninja':'rogue')+`.png" class="job-icon"><br/>`+(nin_level>0?nin_level:rog_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`samurai.png" class="job-icon"><br/>`+sam_level+`</div>
                  </div>
                </div>
                <div class="job-container">
                  <div class="range-physical" style="width: 33%;">
                    <div class="job"><img src="`+jobIconBasePath+(brd_level>0?'bard':'archer')+`.png" class="job-icon"><br/>`+(brd_level>0?brd_level:arc_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`machinist.png" class="job-icon"><br/>`+mch_level+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`dancer.png" class="job-icon"><br/>`+dnc_level+`</div>
                  </div>
                  <div class="range-magic" style="width: 33%; padding-left: 15px;">
                    <div class="job"><img src="`+jobIconBasePath+(blm_level>0?'blackmage':'thaumaturge')+`.png" class="job-icon"><br/>`+(blm_level>0?blm_level:thm_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+(sum_level>0?'summoner':'arcanist')+`.png" class="job-icon"><br/>`+(sum_level>0?sum_level:acn_level)+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`redmage.png" class="job-icon"><br/>`+rdm_level+`</div>
                    <div class="job"><img src="`+jobIconBasePath+`bluemage.png" class="job-icon"><br/>`+blu_level+`</div>
                  </div>
                  <div class="special" style="width: 33%;">
                    <div class="job"><img src="`+jobIconBasePath+`reaper.png" class="job-icon"><br/>`+rpr_level+`</div>
                  </div>
                </div>
              </div>
              <div class="doh-dol" style="display: flex;">
                <div class="doh" style="width: 66%;">
                  <div class="job-label">DoH</div>
                  <div class="job-container">
                    <div class="crafters" style="width: 100%;">
                      <div class="job"><img src="`+jobIconBasePath+`alchemist.png" class="job-icon"><br/>`+alc_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`culinarian.png" class="job-icon"><br/>`+cul_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`weaver.png" class="job-icon"><br/>`+wvr_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`leatherworker.png" class="job-icon"><br/>`+ltw_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`carpenter.png" class="job-icon"><br/>`+crp_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`goldsmith.png" class="job-icon"><br/>`+gsm_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`armorer.png" class="job-icon"><br/>`+arm_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`blacksmith.png" class="job-icon"><br/>`+bsm_level+`</div>
                    </div>
                  </div>
                </div>
                <div class="dol" style="width: 33%;">
                  <div class="job-label">DoL</div>
                  <div class="job-container">
                    <div class="gatherers" style="width: 100%;">
                      <div class="job"><img src="`+jobIconBasePath+`botanist.png" class="job-icon"><br/>`+bot_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`miner.png" class="job-icon"><br/>`+min_level+`</div>
                      <div class="job"><img src="`+jobIconBasePath+`fisher.png" class="job-icon"><br/>`+fsh_level+`</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </body>

  <style>
    html {
      font-family: Verdana, Open Sans;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    body {
      width: 800px;
      margin: 0;
      padding: 0;
      font-size: 28px;
    }
    .main-container {
      display: flex;
      background: #000;
      color: #fff;
      width: 800px;
    }
    .left-col {
      background-image: url(`+avatar+`);
      background-repeat: no-repeat;
      background-size: cover;
      background-position: center;
      width: 40%;
      border-left: 5px solid #000;
      border-top: 5px solid #000;
      border-bottom: 6px solid #000;
    }
    .right-col {
      background: rgba(0,0,0,1);
      width: 60%;
      position: relative;
      padding: 5px;
    }
    .title {
      font-size: .8rem;
      position: relative;
    }
    .name {
      font-size: 1.8rem;
    }
    .right-col > div {
      width: 100%;
    }
    .right-col-item {
      padding: 15px;
    }
    .right-col-content > div {
      border-radius: 2px;
      background: rgba(255,255,255,.15);
      width: 100%;
      text-align: center;
    }
    .right-col-content > div:not(:last-child) {
      margin-bottom: 5px;
    }
    .title,
    .job-label,
    .fc-label,
    .collection-label {
      font-size: 1rem;
      color: yellow;
      margin-bottom: 2px;
      font-weight: bold;
      letter-spacing: 1px;
    }
    .text-left {
      text-align: left;
    }
    .jobs {
      font-size: 1.2rem;
    }
    .job-icon {
      width: 25px;
      margin-bottom: 1px;
    }
    .job {
      text-align: center;
      display: inline-block;
    }
    .job:not(:last-child) {
      margin-right: 2px;
    }
    .job-container {
      display: flex;
      position: relative;
      left: -2px;
      margin: 5px 0;
    }
    .doh-dol {
      margin-top: 10px;
    }
  </style>
</html>`;

    return html;
}

/******************************
  Exports
*******************************/

module.exports = {
  searchCharacter,
  searchCharacterOwnServer,
  searchCharacterByLodestoneID,
  getCharacterInfoXIVAPI,
  getCharacterInfoOwnServer,
  getCharacterTitle,
  printCharacterInfo,
  printGlamInfo,
  getUserProfileHTML,
  generateUserProfile,
  setUserProfile,
  getUserProfile,
  setUserInfo,
  getUserInfo
}
