import { invoke, process, shell } from "@tauri-apps/api";
import { getVersion } from "@tauri-apps/api/app";
import { ask, confirm, message } from "@tauri-apps/api/dialog";
import { exists } from "@tauri-apps/api/fs";
import { type } from "@tauri-apps/api/os";
import { getCachedList, getUpdateInfo } from "../api/apis";
import { useAppState } from "../states/app";
import { usePersistentServersStore, useServers } from "../states/servers";
import { APIResponseServer, Player, SearchData, Server } from "./types";
import { useMessageBox } from "../states/messageModal";
import { queryServer } from "./query";

export const mapAPIResponseServerListToAppStructure = (
  list: APIResponseServer[]
) => {
  const restructuredList: Server[] = list.map((server) => {
    return {
      hostname: server.core.hn,
      gameMode: server.core.gm,
      ip: server.core.ip.split(":")[0],
      port: parseInt(server.core.ip.split(":")[1]),
      language: server.core.la,
      hasPassword: server.core.pa,
      playerCount: server.core.pc,
      maxPlayers: server.core.pm,
      version: server.core.vn,
      rules: server.ru,
      players: [] as Player[],
      ping: 0,
      usingOmp: server.core.omp,
      partner: server.core.pr,
    } as Server;
  });

  return restructuredList;
};

export const fetchServers = async (cached: boolean = true) => {
  if (cached) {
    const { updateServer } = useServers.getState();
    const { updateInFavoritesList, updateInRecentlyJoinedList, favorites } =
      usePersistentServersStore.getState();

    if (Array.isArray(favorites)) {
      // let's query servers from server list so players have updated data
      for (let i = 0; i < favorites.length; i += 10) {
        setTimeout(() => {
          for (let offset = 0; offset < 10; offset++) {
            if (favorites[i + offset]) {
              queryServer(favorites[i + offset])
                .then((server) => {
                  updateServer(server);
                  updateInFavoritesList(server);
                  updateInRecentlyJoinedList(server);
                })
                .catch((e) => console.log(e));
            }
          }
        }, 500 + (i % 10) * 1000);
      }
    }

    const response = await getCachedList();
    useServers.getState().setServers(response.servers);

    console.log(response);
    if (Array.isArray(response.servers)) {
      // let's query servers from server list so players have updated data
      for (let i = 0; i < response.servers.length; i += 15) {
        setTimeout(() => {
          for (let offset = 0; offset < 15; offset++) {
            if (response.servers[i + offset])
              queryServer(response.servers[i + offset])
                .then((server) => {
                  updateServer(server);
                  updateInFavoritesList(server);
                  updateInRecentlyJoinedList(server);
                })
                .catch((e) => console.log(e));
          }
        }, 500 + (i / 15) * 1000);
      }
    }
  }
};

export const fetchUpdateInfo = async () => {
  const nativeVer = await getVersion();
  const hostOS = await type();
  const response = await getUpdateInfo();
  if (response.info) {
    useAppState.getState().setUpdateInfo(response.info);
    useAppState.getState().setNativeAppVersionValue(nativeVer);
    useAppState.getState().setHostOSValue(hostOS);
  }

  setTimeout(async () => {
    const updateInfo = useAppState.getState().updateInfo;
    const version = useAppState.getState().version;
    if (updateInfo && updateInfo.version != version) {
      const download = await ask(
        `New launcher build is available!
      Your launcher build version: #${version}
      Current launcher vuild version: #${updateInfo.version}
Click "Download" to open release page`,
        {
          type: "info",
          title: "Update Available",
          cancelLabel: "Ignore",
          okLabel: "Download",
        }
      );

      if (download) {
        shell.open(updateInfo.download);
      }
    }
  }, 1000);
  console.log(response);
};

export const startGame = (
  server: Server,
  nickname: string,
  gtasaPath: string,
  sampDllPath: string,
  password: string
) => {
  const { addToRecentlyJoined } = usePersistentServersStore.getState();
  const { showMessageBox, _hideMessageBox } = useMessageBox.getState();
  addToRecentlyJoined(server);
  invoke("inject", {
    name: nickname,
    ip: server.ip,
    port: server.port,
    exe: gtasaPath,
    dll: sampDllPath,
    password: password,
  }).catch(async (e) => {
    if (e == "need_admin") {
      showMessageBox({
        title: "Admin perms required!",
        description:
          'It seems like your GTA: San Andreas game requires administration permissions to run. This can be due to many causes, like having your game installed in "C" drive. Please re-open open.mp launcher as administrator either using "Run as Admin" button or manually by yourself',
        buttons: [
          {
            title: "Run as Admin",
            onPress: async () => {
              await invoke("rerun_as_admin").then(() => {
                process.exit();
              });
            },
          },
          {
            title: "Cancel",
            onPress: () => _hideMessageBox(),
          },
        ],
      });
    }
  });
};

export const checkDirectoryValidity = async (path: string) => {
  const gtasaExists = await exists(path + "/gta_sa.exe");
  if (!gtasaExists) {
    message(
      `Can not find the right GTA San Andreas installation in this directory:
  ${path}
Unable to find "gta_sa.exe" in your given path.
  ${path}/gta_sa.exe does not exist.
    `,
      { title: "gta_sa.exe doesn't exist", type: "error" }
    );
    return false;
  }

  const sampExists = await exists(path + "/samp.dll");
  if (!sampExists) {
    const download = await confirm(
      `Can not find the right SA-MP installation in this directory:
  ${path}
Unable to find "samp.dll" in your given path.
  ${path}/samp.dll does not exist.

Please refer to https://sa-mp.mp/ to download SA-MP
    `,
      {
        title: "samp.dll doesn't exist",
        type: "error",
        cancelLabel: "Close",
        okLabel: "Download",
      }
    );
    if (download) {
      shell.open("https://sa-mp.mp/downloads/");
    }
    return false;
  }

  return true;
};

export const validateServerAddress = (address: string) => {
  if (
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
      address
    )
  ) {
    return true;
  } else {
    // Check if it's a valid domain
    let regex = new RegExp(
      /^(?!-)[A-Za-z0-9-]+([\-\.]{1}[a-z0-9]+)*\.[A-Za-z]{2,6}$/
    );

    // if str
    // is empty return false
    if (address == null) {
      return false;
    }

    // Return true if the str
    // matched the ReGex
    if (regex.test(address) == true) {
      return true;
    } else {
      return false;
    }
  }
};

export const validateWebUrl = (url: string) => {
  if (
    /[(http(s)?):\/\/(www\.)?a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi.test(
      url
    )
  ) {
    return true;
  }
  return false;
};

export const sortAndSearchInServerList = (
  servers: Server[],
  searchData: SearchData,
  checkForPartnership = false
) => {
  const { ompOnly, nonEmpty, query, sortPing, sortPlayer, sortName, sortMode } =
    searchData;
  let list = servers.filter((server) => {
    const ompCheck = ompOnly ? server.usingOmp === true : true;
    const partnershipCheck = checkForPartnership
      ? server.partner === true
      : true;
    const nonEmptyCheck = nonEmpty ? server.playerCount > 0 : true;

    return (
      server.ip &&
      partnershipCheck &&
      ompCheck &&
      nonEmptyCheck &&
      server.hostname.toLowerCase().includes(query.toLowerCase())
    );
  });

  if (sortPing !== "none") {
    list = list.sort((a, b) => {
      if (sortPing === "descending") {
        return a.ping - b.ping;
      } else {
        return b.ping - a.ping;
      }
    });
  }

  if (sortPlayer !== "none") {
    list = list.sort((a, b) => {
      if (sortPlayer === "descending") {
        return a.playerCount - b.playerCount;
      } else {
        return b.playerCount - a.playerCount;
      }
    });
  }

  if (sortName !== "none") {
    list = list.sort((a, b) => {
      const nameA = a.hostname.toUpperCase();
      const nameB = b.hostname.toUpperCase();
      let aFirst = false;
      if (nameA < nameB) {
        aFirst = true;
      }

      if (sortName === "descending") {
        return aFirst ? -1 : 1;
      } else {
        return aFirst ? 1 : -1;
      }
    });
  }

  if (sortMode !== "none") {
    list = list.sort((a, b) => {
      const nameA = a.gameMode.toUpperCase();
      const nameB = b.gameMode.toUpperCase();
      let aFirst = false;
      if (nameA < nameB) {
        aFirst = true;
      }

      if (sortMode === "descending") {
        return aFirst ? -1 : 1;
      } else {
        return aFirst ? 1 : -1;
      }
    });
  }

  return list;
};
