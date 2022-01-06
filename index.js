const Discord = require("discord.js");
const client = new Discord.Client({
    intents: [
        Discord.Intents.FLAGS.GUILDS,
        Discord.Intents.FLAGS.GUILD_MESSAGES,
        Discord.Intents.FLAGS.GUILD_VOICE_STATES,
    ],
});

const nodes = [
    {
        host: "localhost",
        password: "youshellnotpass",
        port: 2333,
    },
];

const Lavalink = require("erela.js");
// import { Knex } from "knex";
const manager = new Lavalink.Manager({
    nodes,
    send: (id, payload) => {
        const guild = client.guilds.cache.get(id);
        if (guild) guild.shard.send(payload);
    },
});

/** @type {Knex} */
const knex = require("knex")({
    client: "sqlite3",
    connection: {
        filename: "./playlists.db",
    },
});

knex.schema.hasTable("playlist").then((exists) => {
    if (exists) return;
    knex.schema.createTable("playlist", (t) => {
        t.integer("id").primary();
        t.text("name");
        t.text("userId");
        t.text("tracks");
    });
    console.log("Created playlist table");
});

const ms = require("ms");

require("dotenv").config();

manager.on("nodeConnect", (node) => {
    console.log(`Node ${node.options.identifier} connected.`);
});

manager.on("nodeError", (node, error) => {
    console.log(`Node ${node.options.identifier} encountered an error: ${error.message}.`);
});

manager.on("queueEnd", (node) => {
    setTimeout(() => {
        let presentNode = manager.get(node.guild);
        if (!presentNode.queue.current) presentNode.destroy();
    }, ms("5m"));
});

manager.on("trackStart", (player, track) => {
    /** @type {Discord.TextChannel} */
    let channel = client.channels.resolve(player.textChannel);
    channel.send(`Now playing *${track.title}*`);
});

client.once("ready", () => {
    manager.init(client.user.id);
    console.log(`Logged in as ${client.user.username}`);
});

client.on("raw", async (d) => manager.updateVoiceState(d));

client.on("messageCreate", async (message) => {
    const [name, ...args] = message.content.split(/\s+/g);

    if (!name.startsWith("!")) return;

    if (name == "!play") {
        const search = args.join(" ");
        if (!search) return message.reply("Search for a song :v");
        let res;
        try {
            res = await manager.search(search, message.author);
            console.log(res.playlist);
            if (res.loadType == "LOAD_FAILED") throw res.exception;
        } catch (e) {
            return message.reply(e.message);
        }

        if (res.loadType == "NO_MATCHES") return message.reply("nothing found :(");

        const player = manager.create({
            guild: message.guild.id,
            voiceChannel: message.member.voice.channel.id,
            textChannel: message.channel.id,
        });

        player.connect();
        if (res.loadType == "SEARCH_RESULT") player.queue.add(res.tracks[0]);
        if (res.loadType == "TRACK_LOADED") player.queue.add(res.tracks[0]);
        if (res.loadType == "PLAYLIST_LOADED") player.queue.add(res.tracks);
        console.log(player.playing, player.paused, player.queue.size);
        if (!player.playing && !player.paused && !player.queue.size) player.play();
        return message.reply(`enqueued ${res.tracks[0].title}`);
    }

    let player = manager.get(message.guildId);
    if (!player) return message.reply("im not connected to vc");

    if (name == '!force') {
        player.play();
    }

    if (name == "!pause" || name == "!resume") {
        player.pause(!player.paused);
        message.reply(player.paused ? "Paused" : "Unpaused");
    } else if (name == "!seek") {
        try {
            player.seek(ms(args[0]));
            message.reply(`Song time set to ${ms(ms(args[0]))}`);
        } catch (e) {
            if (e) message.reply("Not a valid time");
        }
    } else if (name == "!volume") {
        try {
            player.setVolume(Math.abs(args[0]) > 150 ? 150 : Math.abs(args[0]));
            message.reply(`Song volume set to ${player.volume}`);
        } catch (e) {
            if (e) message.reply("Not a valid volume");
        }
    } else if (name == "!stop") {
        player.destroy();
        message.reply(":+1:");
    } else if (name == "!queue") {
        let out = player.queue
            .map((track, i) => `${i + 1}: ${track.title}`)
            .join("\n")
            .trimEnd();
        message.reply("queue:\n" + out);
    } else if (name == "!np") {
        if (player.queue.current) message.reply(player.queue.current.title);
        else message.reply("Nothing is playing!");
    } else if (name == "!skip") {
        player.stop();
        message.react("👍");
    } else if (name == "!clear") {
        player.queue.clear();
        message.reply("Cleared the queue!");
    } else if (name == "!repeat") {
        player.setTrackRepeat(!player.trackRepeat);
        // prettier-ignore
        message.reply(player.trackRepeat ? 'The current track is now repeating' : 'Stopped repeating of the current track')
    } else if (name == "!loop") {
        player.setQueueRepeat(!player.queueRepeat);
        message.reply(player.trackRepeat ? "The queue is now looped" : "The queue is no longer looped");
    } else if (name == "!shuffle") {
        player.queue.sort(() => Math.random() - 0.5);
        message.react("👍");
    } else if (name == "!remove") {
        try {
            let track = player.queue.at(args[0] == "last" ? player.queue.length - 1 : args[0]);
            if (!track) throw {};
            player.queue.remove(args[0] == "last" ? player.queue.length - 1 : args[0]);
            message.reply(`${track.title} was removed!`);
        } catch (e) {
            message.reply("Invalid index");
        }
    } else if (name == "!playlist") {
        if ("create".startsWith(args[0])) {
            let name = args.slice(1).join(" ");
            if (!name) {
                message.reply("Please supply name for the playlist");
                name = (
                    await message.channel.awaitMessages({
                        filter: (m) => m.author.id == message.author.id,
                        max: 1,
                        time: 60e3,
                        errors: ["time"],
                    })
                ).first().content;
                if (!name) return;
            }

            let playlist = player.queue.concat([player.queue.current]);
            knex("playlist").insert({ name, userId: message.author.id, tracks: JSON.stringify(playlist) });

            message.reply(`New playlist added ${name} with ${playlist.length} tracks!`);
        } else if ("list".startsWith(args[0])) {
            try {
                let name = args.slice(1).join(" ");
                let playlists = await knex("playlist").select("id", "name").where("userId", message.author.id);
                if (!name) {
                    let out = playlists.map((t, i) => `${i + 1}: ${t}`) + "​"; /* zero width space */
                    message.reply(out);
                    return;
                }
                let playlist = playlists.find((p) => p.name.startsWith(name));
                let tracks = await knex("playlist_item").select("track").where("id", playlist.id);
                tracks = tracks.map((t) => JSON.parse(t));
                let out = tracks.map((t, i) => `${i + 1}: ${t}`) + "​"; /* zero width space */
                message.reply(out);
            } catch (e) {
                message.reply("No playlists found!");
            }
        } else if ("play".startsWith(args[0])) {
            try {
                let name = args.slice(1).join(" ");
                let playlists = await knex("playlist").select("id", "name").where("userId", message.author.id);
                let playlist = playlists.find((p) => p.name.startsWith(name));
                let tracks = await knex("playlist_item").select("track").where("id", playlist.id);
                player.play(tracks);
            } catch (e) {
                message.reply("No playlist found!");
            }
        } else if ("remove".startsWith(args[0])) {
            let name = args.slice(1).join(" ");
            let playlists = await knex("playlist").select("id", "name").where("userId", message.author.id);
            let playlist = playlists.find((p) => p.name.startsWith(name));
            if (!playlist) return message.reply("No playlist found!");
            await knex("playlist").delete().where("id", playlist.id);
            message.reply(`Removed playlist ${playlist.name}!`);
        }
    }
});

client.login(process.env.TOKEN);
