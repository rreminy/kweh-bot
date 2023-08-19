/******************************
  Variables & Libs
*******************************/

const config = require('../../config').production;
const helper = require('../../helper');
const dcserver = require('../dcserver');
const Discord = require("discord.js");
const axios = require('axios');
const lodash = require('lodash');
const moment = require("moment");

/******************************
  Marketboard Functions
*******************************/

const getMarketboardListings = async function(itemID, dcOrServerOrRegion) {

  let mbListings = {};
  let apiUrl = config.universalisApiBaseURL + dcOrServerOrRegion.charAt(0).toUpperCase() + dcOrServerOrRegion.slice(1) + "/" + itemID;

  helper.printStatus("Marketboard API: " + apiUrl);

  await axios.get(apiUrl).then(async function(response){
    if( response.status === 200 ) {
      if( response.data ) {
        mbListings = response.data;
        mbListings.status = response.status;
      }
    }
  })
  .catch(async function(err){
    console.log(err);
    if( err.response ) {
      mbListings.status = err.response.status;
    }
  });

  return mbListings;
}

/******************************
  Multiple Matched Item
*******************************/

const handleMultipleItems = async function(itemMatchResult, searchedItem, dcOrServerOrRegion, isDCSupplied, isRegionSupplied, message) {
  // multiple matching results
  let options = await sendMultipleItemsMatchedMsg(itemMatchResult, searchedItem, message);

  // Ensure text entered is one of the options in above array
  let multipleItemsfilter = function response(m){
    return options.includes( parseInt(m.content) );
  };

  // Await Reply
  message.response_channel.awaitMessages({ multipleItemsfilter, max: 1, time: config.userPromptsTimeout }).then(async function(collected){
    let itemInfo = itemMatchResult[ collected.first().content - 1 ];
    await printMarketboardResult(itemInfo, dcOrServerOrRegion, isDCSupplied, isRegionSupplied, message);

    // Auto Delete
    if( message.serverSettings["auto_delete"] ) {
      collected.first().delete().catch(function(err){
        if( err.code == 50013 ) {
          console.log(err.message);
        }
      });
    }

  }).catch(function(collected){
    helper.sendErrorMsg("Error", "No item was specified", message);
  });
}

/******************************
  Multiple Matched Item Prompt
*******************************/
const sendMultipleItemsMatchedMsg = async function(items, searchedKeyword, message){

  let options = [];

  if(items.length > 0) {
    // Embed
    let embed = new Discord.MessageEmbed()
      .setColor(config.defaultEmbedColor)
      .setAuthor({name: searchedKeyword, iconURL: config.universalisLogo});

    let description = "どのアイテムを探していますか?\n";

    for(var i=0; i<items.length; i++) {

      // Character limit check
      if( (description+"\n" + (i+1) + ". " + items[i].Name).length > 2048 )
        break;

      description+= "\n" + (i+1) + ". " + items[i].Name;
      options.push(i+1);
    }

    embed.setDescription(description);

    // Channel
    let channel = message.serverSettings["default_channel"] ? message.serverSettings["default_channel"] : message.channel;

    // Send Message
    await channel.send({embeds: [embed]}).catch(function(err){
      console.log(err);
    });
  }

  return options;
}

/******************************
  XIVAPI to Universallis Region Map
*******************************/

function mapToUniversallisRegion(dcOrServerOrRegion) {
    switch (dcOrServerOrRegion.toLowerCase()) {
      case "jp":
        dcOrServerOrRegion = "Japan";
        break;
      case "eu":
        dcOrServerOrRegion = "Europe";
        break;
      case "na":
        dcOrServerOrRegion = "North-America";
        break;
      case "oc":
        dcOrServerOrRegion = "Oceanic";
        break;
      default:
        break;
    }
  return dcOrServerOrRegion;
}

/******************************
  Universallis to XIVAPI Region Map
*******************************/

function mapToXIVAPIRegion(region) {
    switch (region) {
      case "Japan":
        region = "JP";
        break;
      case "Europe":
        region = "EU";
        break;
      case "North-America":
        region = "NA";
        break;
      case "Oceanic":
        region = "OC";
        break;
      default:
        break;
    }
  return region;
}

/******************************
  Get Embed
*******************************/

function getEmbed(mbData) {
  var embed = new Discord.MessageEmbed()
    .setColor(config.defaultEmbedColor)
    .setTitle( mbData.item.Name )
    .setAuthor({name: "Universalis", iconURL: config.universalisLogo, url: config.universalisMarketBaseURL + mbData.item.ID})
    .setThumbnail( config.xivApiBaseURL + mbData.item.Icon );

  // Last Upload Time
  let datetimeUploaded = moment(mbData.lastUploadTime).format("DD MMM YYYY h:mm A");
  embed.setFooter({text: "Data from " + datetimeUploaded});

  return embed;
}

/******************************
  Marketboard Result
*******************************/

const printMarketboardResult = async function(item, dcOrServerOrRegion, isDCSupplied, isRegionSupplied, message) {

  if( isRegionSupplied ) {
    dcOrServerOrRegion = mapToUniversallisRegion(dcOrServerOrRegion);
  }

  let mbListings = await getMarketboardListings( item.ID, dcOrServerOrRegion );

  if( lodash.isEmpty(mbListings) == false && mbListings.listings && mbListings.listings.length > 0 ) {

    mbListings.item = item;
    mbListings.server = isDCSupplied ? "" : dcOrServerOrRegion;
    mbListings.datacenter = isDCSupplied ? dcOrServerOrRegion : "";

    if( isRegionSupplied ) {
      sendMarketboardResult(mbListings, message, false, true);
    }
    else if( isDCSupplied ) {
      sendMarketboardResult(mbListings, message, true, false);
    }
    else {
      sendMarketboardResult(mbListings, message, false, false);
    }
  }
  else {
    if( lodash.isEmpty(mbListings) == false && mbListings.status && mbListings.status >= 500 ) {
      // 500 Error
      helper.sendErrorMsg(item.Name, "結果が見つかりません\nhttps://universalis.app/ seems to be down right now :(", message);
    }
    else {
      // No results
      helper.sendErrorMsg(item.Name, "結果が見つかりません", message);
    }
  }
}

const sendMarketboardResult = async function(mbData, message, isDC=true, isRegion=false) {

  if( mbData.listings ) {

    // Display data center specific results
    if( isRegion ) {
      console.log("Showing region result");
      let region = mapToXIVAPIRegion( mbData.server );
      let dcsOfRegion = config.dcRegions[ region ];

      // Get servers of all dcs in the region
      let dcServers = await dcserver.getDCServers();
      let serversOfRegion = [];

      for(var i=0; i<dcsOfRegion.length; i++) {
        if( dcServers[ dcsOfRegion[i] ] ) {
          serversOfRegion = serversOfRegion.concat(dcServers[ dcsOfRegion[i] ])
        }
      }

      serversOfRegion.sort();

      let embeds = [];

      if( serversOfRegion.length > 0 ) {

          let lowestNQAllServer = [];
          let lowestHQAllServer = [];
          let inline = serversOfRegion.length > 8 ? true : false;

          const fieldsLimit = 25;

          for(var i=0; i<serversOfRegion.length; i++) {

            if( i==0 || i%fieldsLimit==0 ) {
              // Embed
              var embed = getEmbed(mbData)
              embeds.push(embed);
            }

            let currentServerListings = mbData.listings.filter(l => (l.worldName == serversOfRegion[i] && l.onMannequin == false));

            if( currentServerListings.length > 0 ) {
              let lowestNQPrice = getLowestListing(currentServerListings, false);
              let lowestHQPrice = getLowestListing(currentServerListings, true);

              let priceListings = (lodash.isEmpty(lowestNQPrice)?"":lowestNQPrice.pricePerUnit.toLocaleString() + "g [NQ] x "+lowestNQPrice.quantity);
              priceListings += "\n" + (lodash.isEmpty(lowestHQPrice)?"" : lowestHQPrice.pricePerUnit.toLocaleString() + "g [HQ] x "+lowestHQPrice.quantity);

              embed.addFields({ name: serversOfRegion[i], value: String(priceListings), inline: inline });

              if( lodash.isEmpty(lowestNQPrice) == false ) {
                lowestNQAllServer.push(lowestNQPrice);
              }

              if( lodash.isEmpty(lowestHQPrice) == false ) {
                lowestHQAllServer.push(lowestHQPrice);
              }
            }
            else {
              embed.addFields({ name: serversOfRegion[i], value: "利用不可", inline: inline });
            }
          }

          // Get Lowest / Highest
          let description = "";

          if( lowestNQAllServer.length > 0 ) {
            lowestNQAllServer = lodash.sortBy(lowestNQAllServer, ['pricePerUnit']);
            description += "最も安い [NQ] on **" + lowestNQAllServer[0].worldName + "** " + lowestNQAllServer[0].pricePerUnit.toLocaleString() + "g " + " x " + lowestNQAllServer[0].quantity;
          }

          if( lowestHQAllServer.length > 0 ) {
            lowestHQAllServer = lodash.sortBy(lowestHQAllServer, ['pricePerUnit']);
            description += "\n最も安い [HQ] on **" + lowestHQAllServer[0].worldName + "** " + lowestHQAllServer[0].pricePerUnit.toLocaleString() + "g " + " x " + lowestHQAllServer[0].quantity;
          }

          description += "\nShowing data from " + serversOfRegion.length + " servers from the " + mbData.server + " region";

          for(var i=0; i<embeds.length; i++) {
            embeds[i].setDescription(description);
          }
      }

      // Channel
      let channel = message.serverSettings["default_channel"] ? message.serverSettings["default_channel"] : message.channel;

      for(var i=0; i<embeds.length; i++) {
        // Send Message
        channel.send({embeds: [embeds[i]]}).catch(function(err){
          console.log(err);
        });
      }
    }
    else if( isDC ) {
      console.log("Showing dc result");
      var embed = getEmbed(mbData)

      let dcServers = await dcserver.getDCServers();

      if( dcServers[ mbData.datacenter.charAt(0).toUpperCase() + mbData.datacenter.slice(1) ] ) {

        let dc = mbData.datacenter.charAt(0).toUpperCase() + mbData.datacenter.slice(1);
        let servers = dcServers[ dc ];

        if( servers.length > 0 ) {

          let lowestNQAllServer = [];
          let lowestHQAllServer = [];

          for(var i=0; i<servers.length; i++) {
            let currentServerListings = mbData.listings.filter(l => (l.worldName == servers[i] && l.onMannequin == false));

            if( currentServerListings.length > 0 ) {
              let lowestNQPrice = getLowestListing(currentServerListings, false);
              let lowestHQPrice = getLowestListing(currentServerListings, true);

              let priceListings = (lodash.isEmpty(lowestNQPrice)?"":lowestNQPrice.pricePerUnit.toLocaleString() + "g [NQ] x "+lowestNQPrice.quantity);
              priceListings += "\n" + (lodash.isEmpty(lowestHQPrice)?"" : lowestHQPrice.pricePerUnit.toLocaleString() + "g [HQ] x "+lowestHQPrice.quantity);

              embed.addFields({ name: servers[i], value: String(priceListings) });

              if( lodash.isEmpty(lowestNQPrice) == false ) {
                lowestNQAllServer.push(lowestNQPrice);
              }

              if( lodash.isEmpty(lowestHQPrice) == false ) {
                lowestHQAllServer.push(lowestHQPrice);
              }
            }
            else {
              embed.addFields({name: servers[i], value: "Not available" });
            }
          }

          // Get Lowest / Highest
          let description = "";

          if( lowestNQAllServer.length > 0 ) {
            lowestNQAllServer = lodash.sortBy(lowestNQAllServer, ['pricePerUnit']);
            description += "最も安い [NQ] on **" + lowestNQAllServer[0].worldName + "** " + lowestNQAllServer[0].pricePerUnit.toLocaleString() + "g " + " x " + lowestNQAllServer[0].quantity;
          }

          if( lowestHQAllServer.length > 0 ) {
            lowestHQAllServer = lodash.sortBy(lowestHQAllServer, ['pricePerUnit']);
            description += "\n最も安い [HQ] on **" + lowestHQAllServer[0].worldName + "** " + lowestHQAllServer[0].pricePerUnit.toLocaleString() + "g " + " x " + lowestHQAllServer[0].quantity;
          }

          description += "\nShowing data from " + servers.length + " servers from the " + dc + " datacenter";

          embed.setDescription(description);
        }
      }

      // Channel
      let channel = message.serverSettings["default_channel"] ? message.serverSettings["default_channel"] : message.channel;

      // Send Message
      channel.send({embeds: [embed]}).catch(function(err){
        console.log(err);
      });
    }
    // Display server specific results
    else {
      console.log("Showing server result");
      var embed = getEmbed(mbData)

      // Sort ascending
      let listings = mbData.listings.filter(l => l.onMannequin == false);
      listings = lodash.sortBy(listings, ['pricePerUnit']);

      let lowestNQPrice = getLowestListing(listings, false);
      let lowestHQPrice = getLowestListing(listings, true);

      let description = "最も安い NQ: " + ( lodash.isEmpty(lowestNQPrice) ? 'Not available' : lowestNQPrice.pricePerUnit.toLocaleString() + "g x "+lowestNQPrice.quantity );
      description += "\n最も安い HQ: " + ( lodash.isEmpty(lowestHQPrice) ? 'Not available' : lowestHQPrice.pricePerUnit.toLocaleString() + "g x "+lowestHQPrice.quantity );

      embed.setDescription(description);

      let listLimit = 20;
      let priceListings = "";

      for(var i=0; i<listings.length; i++) {
        if( i == listLimit )
          break;

        priceListings += "\n" + listings[i].pricePerUnit.toLocaleString() + "g "+(listings[i].hq?"[HQ]":"[NQ]")+" x " + listings[i].quantity;
      }

      // Listings
      embed.addFields({ name: mbData.server.charAt(0).toUpperCase() + mbData.server.slice(1), value: priceListings });

      // Channel
      let channel = message.serverSettings["default_channel"] ? message.serverSettings["default_channel"] : message.channel;

      // Send Message
      channel.send({embeds: [embed]}).catch(function(err){
        console.log(err);
      });
    }
  }
}

const getHighestListing = function(listings, hq=false) {

  let highestPricedItem = {};

  for(var i=0; i<listings.length; i++) {

    if( hq == true && listings[i].hq != true )
      continue;

    if( hq == false && listings[i].hq == true )
      continue;

    if( lodash.isEmpty(highestPricedItem) || listings[i].pricePerUnit < highestPricedItem.pricePerUnit ) {
      highestPricedItem = listings[i];
    }
  }

  return highestPricedItem;
}

const getLowestListing = function(listings, hq=false) {

  let lowestPricedItem = {};

  for(var i=0; i<listings.length; i++) {

    if( hq == true && listings[i].hq != true )
      continue;

    if( hq == false && listings[i].hq == true )
      continue;

    if( lodash.isEmpty(lowestPricedItem) || listings[i].pricePerUnit < lowestPricedItem.pricePerUnit ) {
      lowestPricedItem = listings[i];
    }
  }

  return lowestPricedItem;
}

/******************************
  Exports
*******************************/

module.exports = {
  getMarketboardListings,
  sendMultipleItemsMatchedMsg,
  printMarketboardResult,
  sendMarketboardResult,
  getHighestListing,
  getLowestListing,
  handleMultipleItems
}