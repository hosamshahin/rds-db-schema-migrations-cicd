import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as sm from "aws-cdk-lib/aws-secretsmanager";

export class Database extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly secretName: cdk.CfnOutput;
  public readonly secretArn: cdk.CfnOutput;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly defaultDBName: string = "postgres";

  constructor(scope: Construct, id: string, stageName: string) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'RdsVpc');

    const securityGroup = new ec2.SecurityGroup(this, 'LambdaPostgresConnectionSG', {
      vpc: this.vpc,
      description: "Lambda security group to connect to Postgres db.",
      allowAllOutbound: true
    })

    securityGroup.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow Postgres Communication')

    const secret = new sm.Secret(this, 'Secret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '/@"',
      },
    });

    new rds.DatabaseInstance(this, "PostgresInstance", {
      engine: rds.DatabaseInstanceEngine.POSTGRES,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: {
        username: secret.secretValueFromJson('username').toString(),
        password: secret.secretValueFromJson('password')
      },
      vpc: this.vpc,
      publiclyAccessible: stageName === 'dev' ? true : false,
      securityGroups: [securityGroup],
      databaseName: this.defaultDBName
    });


    // Outputs
    this.secretName = new cdk.CfnOutput(this, 'secretName', {
      value: secret.secretName
    });

    this.secretArn = new cdk.CfnOutput(this, 'secretArn', {
      value: secret.secretArn
    });

    this.securityGroup = securityGroup;
  }
}


