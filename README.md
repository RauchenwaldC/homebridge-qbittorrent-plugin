# qBittorrent Homebridge Plugin

![NPM Version](https://img.shields.io/npm/v/homebridge-qbittorrent-plugin)
![NPM Downloads](https://img.shields.io/npm/dw/homebridge-qbittorrent-plugin)
![Static Badge](https://img.shields.io/badge/PayPal.me-%23efefef?logo=paypal&logoColor=%23003087&link=https%3A%2F%2Fwww.paypal.com%2Fpaypalme%2FChristianRauchenwald)

## Description

`homebridge-qbittorrent-plugin` is a Homebridge platform plugin that integrates qBittorrent with Apple HomeKit, allowing users to toggle advanced rate limits via HomeKit switches.

## Features

- Toggle qBittorrent's advanced rate limits on/off from Apple HomeKit.
- Supports multiple versions of Node.js and Homebridge.

## Installation

1. Open the Homebridge UI.
2. Go to the **Plugins** section.
3. Search for **homebridge-qbittorrent-plugin**.
4. Click **Install** to install the plugin.

5. Configure the plugin through the Homebridge UI or manually by adding the following to your `config.json`:

    ```json
    {
      "platforms": [
        {
          "platform": "qBittorrentHomebridgePlugin",
          "name": "qBittorrent Platform",
          "apiUrl": "http://localhost:8080",
          "username": "admin",
          "password": "adminadmin"
        }
      ]
    }
    ```

## Configuration

| Field     | Description                           | Required | Default               |
|-----------|---------------------------------------|----------|-----------------------|
| `name`    | Name of the platform                  | Yes      | `qBittorrent Platform`|
| `apiUrl`  | URL of the qBittorrent WebUI API      | Yes      | `http://localhost:8080`|
| `username`| Username for the WebUI                | No       | Empty string          |
| `password`| Password for the WebUI                | No       | Empty string          |

## Usage

- After setting up the plugin, a new switch called **Advanced Rate Limits** will be available in HomeKit.
- You can use this switch to enable or disable the advanced rate limits feature of qBittorrent.

## License

This project is licensed under the Apache-2.0 License. See the [LICENSE](LICENSE) file for more details.

## Issues

For any issues, please report them on the [issue tracker](https://git.convertain.com/christian-rauchenwald/homebridge/homebridge-qbittorrent-plugin/-/issues).
