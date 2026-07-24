import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: '老魏的工作笔记（Node.js 版）',
  tagline: 'Node.js 服务端开发实践与工作笔记',
  favicon: 'img/favicon.ico',

  // Set the production url of your site here
  url: 'https://weihongyu12.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/node/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'weihongyu12', // Usually your GitHub org/user name.
  projectName: 'node', // Usually your repo name.

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/weihongyu12/node/edit/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: '老魏的工作笔记（Node.js 版）',
      logo: {
        alt: 'My Site Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'gettingStartedSidebar',
          position: 'left',
          label: '指南',
        },
        {
          type: 'docSidebar',
          sidebarId: 'specificationSidebar',
          position: 'left',
          label: '规范',
        },
        {
          type: 'docSidebar',
          sidebarId: 'featuresSidebar',
          position: 'left',
          label: '功能设计',
        },
        {
          type: 'docSidebar',
          sidebarId: 'integrationSidebar',
          position: 'left',
          label: '微服务集成',
        },
        {
          type: 'docSidebar',
          sidebarId: 'pipelineSidebar',
          position: 'left',
          label: '流水线',
        },
        {
          type: 'docSidebar',
          sidebarId: 'referenceSidebar',
          position: 'left',
          label: '参考',
        },
        {
          to: '/docs/support',
          position: 'left',
          label: '支持',
        },
        {
          href: 'https://weihongyu12.github.io/web/',
          label: 'Web版',
          position: 'right',
        },
        {
          href: 'https://weihongyu12.github.io/miniprogram/',
          label: '小程序版',
          position: 'right',
        },
        {
          href: 'https://github.com/weihongyu12/node',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: '指南',
              to: '/docs/getting-started/',
            },
            {
              label: '规范',
              to: '/docs/specification/directory/',
            },
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: '功能设计',
              to: '/docs/features/',
            },
            {
              label: '微服务集成',
              to: '/docs/integration/',
            },
            {
              label: '流水线',
              to: '/docs/pipeline/',
            },
            {
              label: '配置参考',
              to: '/docs/reference/configuration/',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              href: 'https://weihongyu.com/',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/weihongyu12/node',
            },
            {
              label: 'Donation 捐赠',
              to: '/docs/support',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Wei Hongyu. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: [
        'json5',
        'bash',
        'ini',
        'http',
        'docker',
        'nginx',
        'java',
        'php',
        'csharp',
      ],
    },
  } satisfies Preset.ThemeConfig,

  plugins: [
    '@docusaurus/plugin-pwa',
  ],

  themes: ['@docusaurus/theme-mermaid'],
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
    mermaid: true,
  },

  future: {
    faster: true,
    v4: true,
  },
};

export default config;
