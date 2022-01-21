# blaseball-archive-scripts

[SIBR](https://sibr.dev) archives data from blaseball.com and makes it available using Chronicler. If you're interested in using it, you can find documentation and helpful people in our Discord server.

However, we've determined over the first several months of Blaseball that having a backup archival system in place (using a separate codebase) is useful for ensuring data is archived even if there's a bug in either system. This is a purposefully-simple archival script that writes data to a compressed JSON log file, separated every 15 minutes.

Logs from this system are publicly available on `s3://blaseball-archive-iliana/v2/`. You can use an S3-compatible client to list and download files without needing to sign requests, e.g.:

```
aws --no-sign-request s3 ls s3://blaseball-archive-iliana/v2/
```

**Please** use the `v2/` prefix when making requests.

## v2 logging format

Logs are gzipped files that contain a JSON object per line. Each JSON object has the following shape:

```
{
  "version": "2",
  "processId": [UUID generated by your process, found in .client_id],
  "endpoint": [blaseball.com endpoint used, e.g. "/database/globalEvents"],
  "id": [the ID of the object where relevant, null if not],
  "time": [time of the request in seconds since the UNIX epoch],
  "data": {
    ...
  }
}
```

## Chronicler data type mapping

(https://github.com/xSke/Chronicler/blob/main/SIBR.Storage.Data/Models/UpdateType.cs)

| Chronicler data type                 | Endpoint used                                   |
| ------------------------------------ | ----------------------------------------------- |
| Player                               | `/database/players`                             |
| Team                                 | Stream: `.value.leagues.teams[]`                |
| Stream                               | `/events/streamData`                            |
| Game                                 | Stream: `.value.games.schedule[]`               |
| Idols                                | `/api/getIdols`                                 |
| Tributes                             | `/api/getTribute`                               |
| Temporal                             | Stream: `.value.temporal`                       |
| Tiebreakers                          | Stream: `.value.leagues.tiebreakers[]`          |
| Sim                                  | Stream: `.value.games.sim`                      |
| GlobalEvents                         | `/database/globalEvents`                        |
| OffseasonSetup                       | `/database/offseasonSetup`                      |
| Standings                            | Stream: `.value.games.standings`                |
| Season                               | Stream: `.value.games.season`                   |
| League                               | Stream: `.value.leagues.leagues[]`              |
| Subleague                            | Stream: `.value.leagues.subleagues[]`           |
| Division                             | Stream: `.value.leagues.divisions[]`            |
| GameStatsheet                        | `/database/gameStatsheets`                      |
| TeamStatsheet                        | `/database/teamStatsheets`                      |
| PlayerStatsheet                      | `/database/playerStatsheets`                    |
| SeasonStatsheet                      | `/database/seasonStatsheets`                    |
| BossFight                            | Stream: `.value.fights.bossFights[]`            |
| OffseasonRecap                       | `/database/offseasonRecap`                      |
| BonusResult                          | `/database/bonusResults`                        |
| DecreeResult                         | `/database/decreeResults`                       |
| EventResult                          | `/database/eventResults`                        |
| Playoffs                             | Stream: `.value.games.postseason.playoffs`      |
| PlayoffRound                         | Stream: `.value.games.postseason.allRounds[]`   |
| PlayoffMatchup                       | Stream: `.value.games.postseason.allMatchups[]` |
| Tournament                           | Stream: `.value.games.tournament`               |
| Stadium                              | Stream: `.value.leagues.stadiums[]`             |
| RenovationProgress                   | `/database/renovationProgress`                  |
| TeamElectionStats                    | `/database/teamElectionStats`                   |
| Item                                 | Player: `.items[]`                              |
| CommunityChestProgress               | Stream: `.value.leagues.stats.communityChest`   |
| GiftProgress                         | `/database/giftProgress`                        |
| (not yet in Chronicler)              | `/database/sunsun`                              |
| (not yet in Chronicler)              | `/database/renovations`                         |
| (feed; not a Chronicler update type) | `/database/feed/global`                         |
