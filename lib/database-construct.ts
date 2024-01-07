import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export class Database extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const currentAcct = cdk.Stack.of(this).account
    const config = this.node.tryGetContext("config")
    const accounts = config['accounts']
    const envName = currentAcct == accounts['DEV_ACCOUNT_ID'] ? 'dev' : 'prd'
    const defaultDBName = config['resourceAttr']['defaultDBName']

    const vpc = new ec2.Vpc(this, 'RdsVpc', {
      maxAzs: 2,
      natGateways: 0
    });

    const securityGroup = new ec2.SecurityGroup(this, 'LambdaPostgresConnectionSG', {
      vpc,
      description: "Lambda security group to connect to Postgres db.",
      allowAllOutbound: true
    })

    securityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow Postgres Communication')

    const secret = new sm.Secret(this, 'Secret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '/@"',
      },
    });

    const database = new rds.DatabaseInstance(this, "PostgresInstance", {
      engine: rds.DatabaseInstanceEngine.POSTGRES,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: {
        username: secret.secretValueFromJson('username').toString(),
        password: secret.secretValueFromJson('password')
      },
      vpc,
      publiclyAccessible: currentAcct == accounts['DEV_ACCOUNT_ID'] ? true : false,
      securityGroups: [securityGroup],
      databaseName: defaultDBName,
      vpcSubnets: {
        subnetType: currentAcct == accounts['DEV_ACCOUNT_ID'] ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_ISOLATED
      }
    });

    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'LambdaBasicExecution', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'LambdaVPCExecution', 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        secretsManagerPermissions: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue',
                'kms:Decrypt',
              ],
              resources: [
                secret.secretArn
              ]
            }),
          ]
        })
      }
    })

    // The Lambda function that contains the functionality
    const func = new NodejsFunction(this, 'Lambda', {
      functionName: `${config['resourceAttr']['schemaMigrationFnName']}-${envName}`,
      handler: 'handler',
      entry: path.resolve(__dirname, 'lambda/handler.ts'),
      timeout: cdk.Duration.minutes(10),
      bundling: {
        externalModules: [
          'aws-sdk'
        ],
        nodeModules: [
          'knex',
          'pg'
        ],
        commandHooks: {
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [`cp -r ${inputDir}/migrations ${outputDir}`, `find ${outputDir}/migrations -type f ! -name '*.js' -delete`];
          },
          beforeBundling() {
            return [];
          },
          beforeInstall() {
            return [];
          }
        }
      },
      depsLockFilePath: path.resolve(__dirname, 'lambda', 'package-lock.json'),
      projectRoot: path.resolve(__dirname, 'lambda'),
      environment: {
        RDS_DB_PASS_SECRET_ID: secret.secretName,
        RDS_DB_NAME: defaultDBName,
        ENDPOINT: database.dbInstanceEndpointAddress,
        PORT: database.dbInstanceEndpointPort,
      },
      vpc,
      role: lambdaRole,
      securityGroups: [securityGroup]
    })

    new iam.Role(this, 'CrossAccountLambdaRole', {
      roleName: config['resourceAttr']['crossAccountLambdaRole'],
      assumedBy: new iam.AccountPrincipal(accounts['CICD_ACCOUNT_ID']),
      inlinePolicies: {
        invokeLambdaPermissions: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['iam:PassRole'],
              resources: ['*']
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [func.functionArn],
            }),
          ]
        })
      }
    })

    // Outputs
    new cdk.CfnOutput(this, 'secretName', {
      value: secret.secretName
    });

    new cdk.CfnOutput(this, 'secretArn', {
      value: secret.secretArn
    });

  }
}


