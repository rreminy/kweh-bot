/******************************
  Variables & Libs
*******************************/

const config = require('../config').production;
const Discord = require("discord.js");
const axios = require('axios');

/******************************
  Triple Triad Functions
*******************************/

const getFFTripleTriadData = async function(discord_id) {

  let ffTripleTriadData = {};
  let apiUrl = config.ffttApiBaseURL + "users/" + discord_id;

  await axios.get(apiUrl).then(async function(response){

    if( response.status === 200 ) {
      if( response.data ) {
        ffTripleTriadData = response.data;
      }
    }
  })
  .catch(function(err){
    console.log(err);
  });

  return ffTripleTriadData;
}

const printTripleTriadData = function(ffTripleTriadData, message, user) {

  // Embed
  let embed = new Discord.MessageEmbed()
    .setColor(config.defaultEmbedColor)
    .setAuthor({name: user.username + " - Triple Triad Collection", iconURL: config.ffttLogo, url: config.ffttBaseURL + "character/" + user.id});

  embed.addFields(
    { name: "Collected", value: ffTripleTriadData.cards.owned + " / " + ffTripleTriadData.cards.total + " ("+Math.round(ffTripleTriadData.cards.owned/ffTripleTriadData.cards.total*100)+"%)" },
    { name: "Missing", value: ffTripleTriadData.cards.missing + " / " + ffTripleTriadData.cards.total + " ("+Math.round(ffTripleTriadData.cards.missing/ffTripleTriadData.cards.total*100)+"%)" },
    { name: "Web Profile", value: "[Triple Triad Tracker](https://triad.raelys.com/users/"+user.id+")" }
  );

  // Channel
  let channel = message.serverSettings["default_channel"] ? message.serverSettings["default_channel"] : message.channel;

  // Send Message
  channel.send({ embeds: [embed] }).catch(function(err){
    console.log(err);
  });
}

/******************************
  Export
*******************************/

module.exports = {
  getFFTripleTriadData,
  printTripleTriadData
}